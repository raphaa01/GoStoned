from __future__ import annotations

import hashlib
import importlib.metadata
from pathlib import Path
import platform
import shutil
import sys
import urllib.request
import zipfile

from .common import ROOT, atomic_json, read_json

RUNTIME_PACKAGES = ("torch", "numpy", "filelock", "fsspec", "sympy", "networkx", "jinja2", "MarkupSafe", "mpmath", "typing_extensions")


def runtime_file(relative: Path):
    # Eager training/inference needs no C++ headers, link archives or package
    # test suites. Keep code, native runtime libraries, data and all licenses.
    excluded={"__pycache__","include","tests","test","benchmarks","share"}
    if relative.is_absolute() or ".." in relative.parts:
        return False
    if any(marker in relative.name.lower() for marker in ("license","copying","notice")) or any(part.endswith(".dist-info") for part in relative.parts):
        return True
    return (not any(part in excluded for part in relative.parts)
            and relative.suffix not in (".pyc",".pyi",".h",".hpp",".cuh",".lib",".cmake"))


def file_hash(path: Path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(1024*1024):
            value.update(block)
    return value.hexdigest()


def verify_bundle(directory: Path):
    directory = directory.resolve()
    manifest = read_json(directory / "manifest.json")
    if not manifest or manifest.get("schema") != "gostone.puzzle-lab-bundle/1":
        raise ValueError("Invalid bundle manifest")
    for item in manifest["files"]:
        path = (directory / item["path"]).resolve()
        if not path.is_relative_to(directory) or not path.is_file() or file_hash(path) != item["sha256"]:
            raise ValueError(f"Missing or modified bundle file: {item['path']}")
    return {"verified_files": len(manifest["files"]), "runtime": manifest["runtime"]}


def add_windows_runtime(destination: Path, cache: Path):
    if sys.platform != "win32" or platform.machine().lower() not in ("amd64", "x86_64"):
        raise ValueError("The offline runtime builder currently supports Windows x64 only")
    version = platform.python_version()
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"python-{version}-embed-amd64.zip"
    if not archive.exists():
        # Official CPython distribution, including its license, rather than copying a venv.
        url = f"https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip"
        with urllib.request.urlopen(url, timeout=60) as response:
            archive.write_bytes(response.read())
    runtime = destination / "runtime"
    runtime.mkdir()
    with zipfile.ZipFile(archive) as source:
        for member in source.infolist():
            if not (runtime / member.filename).resolve().is_relative_to(runtime.resolve()):
                raise ValueError("Unsafe CPython archive member")
        source.extractall(runtime)
    for path_file in runtime.glob("python*._pth"):
        # Do not enable site: that can append the current user's global Python
        # packages and conceal a missing bundled dependency during validation.
        path_file.write_text(f"python{sys.version_info.major}{sys.version_info.minor}.zip\n.\n..\nsite-packages\n", encoding="utf-8")
    target = runtime / "site-packages"
    target.mkdir()
    versions = {}
    for name in RUNTIME_PACKAGES:
        print(f"Bundling runtime: {name}",flush=True)
        distribution = importlib.metadata.distribution(name)
        versions[name] = distribution.version
        for entry in distribution.files or []:
            relative = Path(str(entry))
            # Exclude command wrappers outside site-packages and machine caches.
            if not runtime_file(relative):
                continue
            source = Path(distribution.locate_file(entry))
            if not source.is_file():
                continue
            output = target / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, output)
    for name in ("Pillow", "opencv-python-headless"):
        try:
            distribution = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            continue
        versions[name] = distribution.version
        print(f"Bundling scan runtime: {name}",flush=True)
        for entry in distribution.files or []:
            relative = Path(str(entry))
            if not runtime_file(relative):
                continue
            source = Path(distribution.locate_file(entry))
            if source.is_file():
                output = target / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, output)
    # Some PyTorch builds need the MSVC runtime already loaded before torch/lib.
    for directory in (Path(sys.base_prefix), Path(sys.base_prefix) / "DLLs"):
        for pattern in ("vcruntime*.dll", "msvcp*.dll"):
            for dll in directory.glob(pattern):
                shutil.copy2(dll, runtime / dll.name)
    return {"type": "offline-embedded-cpython", "python": version, "os": "Windows", "architecture": "x64",
            "packages": versions, "interpreter_archive_sha256": file_hash(archive)}


def export_environment(root: Path, destination: Path, offline_windows=False, include_scans=False):
    destination = destination.resolve()
    if destination.is_relative_to(ROOT.resolve()) or destination.is_relative_to(root.resolve()):
        raise ValueError("Export to a new folder outside the source package and data root")
    if destination.exists():
        raise ValueError("Export destination already exists; choose a new folder")
    destination.mkdir(parents=True)
    package = destination / "training/gostone_puzzles"
    shutil.copytree(ROOT, package, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    (destination / "training/__init__.py").write_text("", encoding="utf-8")
    data_root = destination / "workspace"
    for name in ("data", "models", "reviews", "candidates", "experiments","selfplay"):
        if (root / name).exists():
            shutil.copytree(root / name, data_root / name)
    if (root / "scans").exists():
        print("Copying scan workspace",flush=True)
        shutil.copytree(root / "scans", data_root / "scans",
                        ignore=None if include_scans else shutil.ignore_patterns("originals", "pages"))
    if offline_windows:
        runtime = add_windows_runtime(destination, root / "download-cache")
        command = '"%~dp0runtime\\python.exe"'
    else:
        runtime = {"type": "source-with-pinned-requirements", "python": platform.python_version(),
                   "installation_required": True}
        command = 'python'
    versions = {name: importlib.metadata.version(name) for name in ("torch", "numpy")}
    (destination / "requirements-lock.txt").write_text("\n".join(f"{name}=={version}" for name, version in versions.items())+"\n", encoding="utf-8")
    (destination / "Start-Puzzle-AI.cmd").write_text('@echo off\r\ncd /d "%~dp0"\r\n'+command+' -m training.gostone_puzzles --root "%~dp0workspace" serve\r\npause\r\n', encoding="utf-8")
    (destination / "README.txt").write_text(
        "GoStone Puzzle AI Lab\n\nWindows offline bundle: double-click Start-Puzzle-AI.cmd.\n"
        "Source bundle: Python 3.12+, pip install -r requirements-lock.txt, then\n"
        "python -m training.gostone_puzzles --root workspace serve\n\n"
        "Models are research candidate generators, NOT certified expert composers.\n"
        "The UI distinguishes unproved candidates from proved strategies and human feedback.\n"
        "Review data and optimizer checkpoints are included for continued learning.\n"
        "Scan images are included only when requested. Pending/rights-blocked transcriptions are NOT training data.\n"
        "Review workspace/data/sources.json before distributing historical content in another territory.\n"
        "Third-party software licenses are preserved in runtime/site-packages and runtime/LICENSE.txt.\n"
        "Verify files: python -m training.gostone_puzzles verify-bundle --directory .\n", encoding="utf-8")
    return finalize_archive(destination,runtime)


def finalize_archive(destination: Path,runtime: dict):
    print("Hashing bundled files",flush=True)
    files = [{"path": str(path.relative_to(destination)).replace("\\", "/"), "bytes": path.stat().st_size,
              "sha256": file_hash(path)} for path in sorted(destination.rglob("*"))
             if path.is_file() and path != destination/"manifest.json" and "__pycache__" not in path.parts and path.suffix != ".pyc"]
    manifest = {"schema": "gostone.puzzle-lab-bundle/1", "runtime": runtime, "files": files,
                "model_role": "candidate-proposal-only", "production_ready": False,
                "contains_secrets": False}
    atomic_json(destination / "manifest.json", manifest)
    verify_bundle(destination)
    archive = destination.with_suffix(".zip")
    if archive.exists():
        raise ValueError("Archive path already exists")
    print("Compressing portable archive",flush=True)
    with zipfile.ZipFile(archive, "x", zipfile.ZIP_DEFLATED, compresslevel=3) as output:
        for item in files:
            output.write(destination/item["path"],item["path"])
        output.write(destination/"manifest.json","manifest.json")
    return {"directory": str(destination), "archive": str(archive), "bytes": archive.stat().st_size,
            "verified_files": len(files), "runtime": runtime}
