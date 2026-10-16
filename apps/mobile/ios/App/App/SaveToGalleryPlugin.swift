import Capacitor
import Photos

/// Adds an image or video file (written by the web layer into the app's cache folder) to Photos.
/// Asks only for add-only access (NSPhotoLibraryAddUsageDescription in Info.plist): the app never reads the library.
/// JavaScript: registerPlugin("SaveToGallery").save({ path: "file://…", type: "video/mp4" }) — apps/web/src/platform-native.ts.
@objc(SaveToGalleryPlugin)
public class SaveToGalleryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SaveToGalleryPlugin"
    public let jsName = "SaveToGallery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = URL(string: path), url.isFileURL,
              FileManager.default.fileExists(atPath: url.path) else {
            call.reject("A file:// path to an existing file is required", "argument")
            return
        }
        let isVideo = call.getString("type", "").hasPrefix("video/")
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Access to Photos was not allowed", "denied")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                if isVideo {
                    PHAssetCreationRequest.creationRequestForAssetFromVideo(atFileURL: url)
                } else {
                    PHAssetCreationRequest.creationRequestForAssetFromImage(atFileURL: url)
                }
            }) { ok, error in
                if ok { call.resolve() } else { call.reject(error?.localizedDescription ?? "Could not save", "failed") }
            }
        }
    }
}
