import UIKit
import Capacitor
import WebKit

final class GoStoneBridgeViewController: CAPBridgeViewController, UITabBarDelegate, WKScriptMessageHandler {
    private let nativeTabBar = UITabBar()
    private var destinations: [Int: String] = [:]
    private let symbols = ["house", "puzzlepiece", "graduationcap", "chart.bar.xaxis", "trophy"]

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeTabBar()
        bridge?.webView?.configuration.userContentController.add(self, name: "gostoneChrome")
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
              let body = message.body as? [String: Any],
              body["type"] as? String == "state" else { return }

        if let tabs = body["tabs"] as? [[String: Any]], !tabs.isEmpty {
            destinations.removeAll()
            let items = tabs.enumerated().compactMap { index, tab -> UITabBarItem? in
                guard index < symbols.count,
                      let label = tab["label"] as? String,
                      let href = tab["href"] as? String else { return nil }
                let item = UITabBarItem(title: label, image: UIImage(systemName: symbols[index]), tag: index)
                destinations[index] = href
                return item
            }
            nativeTabBar.setItems(items, animated: nativeTabBar.items != nil)
        }

        if let activeRoute = body["activeRoute"] as? String,
           let index = (body["tabs"] as? [[String: Any]])?.firstIndex(where: { $0["route"] as? String == activeRoute }) {
            nativeTabBar.selectedItem = nativeTabBar.items?[index]
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
