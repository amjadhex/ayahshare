package com.ayahshare.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Adds an image or video file (written by the web layer into the app's cache folder) to the Gallery:
 * Pictures/AyahShare or Movies/AyahShare. Android 10+ needs no permission; 7–9 ask for storage once.
 * JavaScript: registerPlugin("SaveToGallery").save({ path: "file://…", type: "video/mp4" }) — apps/web/src/platform-native.ts.
 */
@CapacitorPlugin(
    name = "SaveToGallery",
    permissions = { @Permission(alias = "storage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }) }
)
public class SaveToGalleryPlugin extends Plugin {
    private static final String FOLDER = "AyahShare";

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageAnswered");
            return;
        }
        write(call);
    }

    @PermissionCallback
    private void storageAnswered(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) write(call);
        else call.reject("Access to storage was not allowed", "denied");
    }

    private void write(PluginCall call) {
        String path = call.getString("path");
        String type = call.getString("type", "");
        File file = path == null ? null : new File(Uri.parse(path).getPath());
        if (file == null || !file.isFile()) {
            call.reject("A file:// path to an existing file is required", "argument");
            return;
        }
        boolean video = type.startsWith("video/");
        String dir = video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES;
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, file.getName());
        values.put(MediaStore.MediaColumns.MIME_TYPE, type);
        Uri collection;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/" + FOLDER);
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            collection = video
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } else {
            File folder = new File(Environment.getExternalStoragePublicDirectory(dir), FOLDER);
            if (!folder.isDirectory() && !folder.mkdirs()) {
                call.reject("Could not create " + folder, "failed");
                return;
            }
            values.put(MediaStore.MediaColumns.DATA, new File(folder, file.getName()).getAbsolutePath());
            collection = video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        }
        Uri item = null;
        try {
            item = resolver.insert(collection, values);
            if (item == null) throw new IllegalStateException("The gallery did not accept the file");
            try (InputStream in = new FileInputStream(file); OutputStream out = resolver.openOutputStream(item)) {
                if (out == null) throw new IllegalStateException("Could not open the gallery file");
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(item, values, null, null);
            }
            call.resolve();
        } catch (Exception e) {
            if (item != null) resolver.delete(item, null, null);
            call.reject("Could not save: " + e.getMessage(), "failed", e);
        }
    }
}
