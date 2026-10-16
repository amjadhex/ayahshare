import Capacitor

/// The app's web view controller: Capacitor's, plus the plugins that live in this project (not in node_modules).
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SaveToGalleryPlugin())
    }
}
