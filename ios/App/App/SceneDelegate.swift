import UIKit
import Capacitor
import WebKit

@objc(GoStoneSharePlugin)
final class GoStoneSharePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "GoStoneSharePlugin"
    let jsName = "GoStoneShare"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)]

    @objc func share(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value), url.scheme == "https" else {
            call.reject("A public HTTPS link is required.")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("The share sheet is unavailable.")
                return
            }
            let sheet = UIActivityViewController(activityItems: [call.getString("text") ?? "", url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 60, width: 1, height: 1)
            sheet.completionWithItemsHandler = { _, _, _, error in
                if let error { call.reject("Could not share the game.", nil, error) }
                else { call.resolve() }
            }
            presenter.present(sheet, animated: true)
        }
    }
}

final class GoStoneBridgeViewController: CAPBridgeViewController, UITabBarDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
    private let nativeTabBar = UITabBar()
    private var destinations: [Int: String] = [:]
    private let symbols = ["house", "puzzlepiece", "graduationcap", "chart.bar.xaxis", "trophy"]
    private var tabDefinitions: [[String: String]] = []
    private var canGoBack = true

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GoStoneSharePlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeTabBar()
        bridge?.webView?.configuration.userContentController.add(self, name: "gostoneChrome")
        bridge?.webView?.scrollView.bounces = false
        bridge?.webView?.scrollView.alwaysBounceVertical = false
        bridge?.webView?.scrollView.contentInsetAdjustmentBehavior = .never
        let backGesture = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(goBack(_:)))
        backGesture.edges = .left
        backGesture.delegate = self
        view.addGestureRecognizer(backGesture)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        canGoBack
    }

    @objc private func goBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard canGoBack, gesture.state == .ended,
              gesture.translation(in: view).x > 70 else { return }
        bridge?.webView?.evaluateJavaScript("window.gostoneBackFromNative?.();")
    }

    deinit {
        bridge?.webView?.configuration.userContentController.removeScriptMessageHandler(forName: "gostoneChrome")
    }

    private func configureNativeTabBar() {
        nativeTabBar.delegate = self
        nativeTabBar.isTranslucent = true
        nativeTabBar.itemPositioning = .fill
        nativeTabBar.tintColor = UIColor(red: 0.25, green: 0.43, blue: 0.36, alpha: 1)
        nativeTabBar.unselectedItemTintColor = .secondaryLabel
        nativeTabBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(nativeTabBar)
        NSLayoutConstraint.activate([
            nativeTabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            nativeTabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            nativeTabBar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -49),
            nativeTabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        nativeTabBar.isHidden = true
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "gostoneChrome",
              let body = message.body as? [String: Any] else { return }

        if body["type"] as? String == "theme" {
            let dark = body["dark"] as? Bool ?? false
            overrideUserInterfaceStyle = dark ? .dark : .light
            let background = dark
                ? UIColor(red: 17/255, green: 19/255, blue: 16/255, alpha: 1)
                : UIColor(red: 245/255, green: 242/255, blue: 235/255, alpha: 1)
            view.backgroundColor = background
            bridge?.webView?.backgroundColor = background
            bridge?.webView?.scrollView.backgroundColor = background
            nativeTabBar.tintColor = dark
                ? UIColor(red: 0.57, green: 0.71, blue: 0.65, alpha: 1)
                : UIColor(red: 0.25, green: 0.43, blue: 0.36, alpha: 1)
            return
        }
        if body["type"] as? String == "navigation" {
            canGoBack = body["canGoBack"] as? Bool ?? false
            return
        }
        guard body["type"] as? String == "state" else { return }

        if let tabs = body["tabs"] as? [[String: String]], !tabs.isEmpty, tabs != tabDefinitions {
            tabDefinitions = tabs
            destinations.removeAll()
            let items = tabs.enumerated().compactMap { index, tab -> UITabBarItem? in
                guard index < symbols.count,
                      let label = tab["label"],
                      let href = tab["href"] else { return nil }
                let item = UITabBarItem(title: label, image: UIImage(systemName: symbols[index]), tag: index)
                destinations[index] = href
                return item
            }
            nativeTabBar.setItems(items, animated: false)
        }

        if let activeRoute = body["activeRoute"] as? String,
           let index = (body["tabs"] as? [[String: Any]])?.firstIndex(where: { $0["route"] as? String == activeRoute }) {
            nativeTabBar.selectedItem = nativeTabBar.items?[index]
        } else {
            nativeTabBar.selectedItem = nil
        }

        let visible = body["visible"] as? Bool ?? false
        nativeTabBar.isHidden = !visible
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard let destination = destinations[item.tag],
              let encoded = try? JSONEncoder().encode(destination),
              let argument = String(data: encoded, encoding: .utf8) else { return }
        bridge?.webView?.evaluateJavaScript("window.gostoneNavigateFromNative?.(\(argument));")
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = GoStoneBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
