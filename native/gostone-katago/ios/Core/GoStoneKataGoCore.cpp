#include "GoStoneKataGoCore.h"

#include "main.h"

#include <condition_variable>
#include <deque>
#include <iostream>
#include <memory>
#include <mutex>
#include <streambuf>
#include <string>
#include <thread>
#include <vector>

namespace {

class InputBuffer final : public std::streambuf {
 public:
  void send(const std::string& line) {
    {
      std::lock_guard<std::mutex> lock(mutex);
      for(const char value : line)
        pending.push_back(value);
      pending.push_back('\n');
    }
    condition.notify_one();
  }

  void close() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      closed = true;
    }
    condition.notify_all();
  }

 protected:
  int_type underflow() override {
    std::unique_lock<std::mutex> lock(mutex);
    condition.wait(lock, [this] { return closed || !pending.empty(); });
    if(pending.empty())
      return traits_type::eof();
    current = pending.front();
    pending.pop_front();
    setg(&current, &current, &current + 1);
    return traits_type::to_int_type(current);
  }

 private:
  std::mutex mutex;
  std::condition_variable condition;
  std::deque<char> pending;
  char current = 0;
  bool closed = false;
};

class OutputBuffer final : public std::streambuf {
 public:
  OutputBuffer(GoStoneKataGoLineCallback callback, void* context)
    : callback(callback), context(context) {}

 protected:
  int_type overflow(int_type value) override {
    if(traits_type::eq_int_type(value, traits_type::eof())) {
      flushLine();
      return traits_type::not_eof(value);
    }
    append(static_cast<char>(value));
    return value;
  }

  std::streamsize xsputn(const char* values, std::streamsize count) override {
    for(std::streamsize index = 0; index < count; index++)
      append(values[index]);
    return count;
  }

  int sync() override {
    flushLine();
    return 0;
  }

 private:
  void append(char value) {
    if(value == '\n')
      flushLine();
    else if(value != '\r')
      line.push_back(value);
  }

  void flushLine() {
    if(line.empty())
      return;
    if(callback != nullptr)
      callback(line.c_str(), context);
    line.clear();
  }

  GoStoneKataGoLineCallback callback;
  void* context;
  std::string line;
};

std::mutex globalEngineMutex;
bool globalEngineActive = false;

}  // namespace

struct GoStoneKataGoEngine {
  InputBuffer input;
  OutputBuffer output;
  GoStoneKataGoExitCallback exitCallback;
  void* context;
  std::string modelPath;
  std::string configPath;
  std::thread worker;

  GoStoneKataGoEngine(
    const char* model,
    const char* config,
    GoStoneKataGoLineCallback lineCallback,
    GoStoneKataGoExitCallback exitCallback,
    void* context
  ) : output(lineCallback, context), exitCallback(exitCallback), context(context),
      modelPath(model), configPath(config) {}
};

extern "C" const char* gostone_katago_version(void) {
  static const std::string version = "v" + Version::getKataGoVersion();
  return version.c_str();
}

extern "C" GoStoneKataGoEngine* gostone_katago_start(
  const char* modelPath,
  const char* configPath,
  GoStoneKataGoLineCallback lineCallback,
  GoStoneKataGoExitCallback exitCallback,
  void* context
) {
  if(modelPath == nullptr || configPath == nullptr || lineCallback == nullptr || exitCallback == nullptr)
    return nullptr;
  {
    std::lock_guard<std::mutex> lock(globalEngineMutex);
    if(globalEngineActive)
      return nullptr;
    globalEngineActive = true;
  }

  auto engine = std::make_unique<GoStoneKataGoEngine>(
    modelPath, configPath, lineCallback, exitCallback, context);
  GoStoneKataGoEngine* rawEngine = engine.get();
  try {
    rawEngine->worker = std::thread([rawEngine] {
      int exitCode = 1;
      std::string error;
      std::streambuf* previousInput = std::cin.rdbuf(&rawEngine->input);
      std::streambuf* previousOutput = std::cout.rdbuf(&rawEngine->output);
      try {
        const std::vector<std::string> arguments = {
          "analysis", "-model", rawEngine->modelPath, "-config", rawEngine->configPath,
          "-quit-without-waiting"
        };
        exitCode = MainCmds::analysis(arguments);
      }
      catch(const std::exception& exception) {
        error = exception.what();
      }
      catch(...) {
        error = "The KataGo engine failed with an unknown native exception.";
      }
      std::cout.flush();
      std::cin.rdbuf(previousInput);
      std::cout.rdbuf(previousOutput);
      {
        std::lock_guard<std::mutex> lock(globalEngineMutex);
        globalEngineActive = false;
      }
      rawEngine->exitCallback(exitCode, error.empty() ? nullptr : error.c_str(), rawEngine->context);
    });
  }
  catch(...) {
    std::lock_guard<std::mutex> lock(globalEngineMutex);
    globalEngineActive = false;
    return nullptr;
  }
  return engine.release();
}

extern "C" int gostone_katago_send(GoStoneKataGoEngine* engine, const char* jsonLine) {
  if(engine == nullptr || jsonLine == nullptr)
    return 0;
  engine->input.send(jsonLine);
  return 1;
}

extern "C" void gostone_katago_stop(GoStoneKataGoEngine* engine) {
  if(engine != nullptr)
    engine->input.close();
}

extern "C" void gostone_katago_destroy(GoStoneKataGoEngine* engine) {
  if(engine == nullptr)
    return;
  engine->input.close();
  if(engine->worker.joinable())
    engine->worker.join();
  delete engine;
}
