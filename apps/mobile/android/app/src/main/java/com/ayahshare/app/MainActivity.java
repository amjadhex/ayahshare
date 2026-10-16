package com.ayahshare.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins that live in this project (not in node_modules) are registered before the bridge starts.
        registerPlugin(SaveToGalleryPlugin.class);
        super.onCreate(savedInstanceState);
        // Videos and recordings kept for offline use can seek (Range requests); see OfflineFilesWebViewClient.
        bridge.setWebViewClient(new OfflineFilesWebViewClient(bridge));
    }
}
