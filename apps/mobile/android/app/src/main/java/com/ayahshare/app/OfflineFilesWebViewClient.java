package com.ayahshare.app;

import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Range requests for the app's offline store (cache/offline, apps/web/src/native/offline.ts), so a video or recording
 * kept on the device can seek. Capacitor's own local server answers a Range request with the file from its first byte
 * (and a Content-Range that says otherwise); this answers it with the bytes asked for. Everything else is Capacitor's.
 */
public class OfflineFilesWebViewClient extends BridgeWebViewClient {
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");
    private final File folder;

    public OfflineFilesWebViewClient(Bridge bridge) {
        super(bridge);
        folder = new File(bridge.getContext().getCacheDir(), "offline");
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String range = header(request, "Range");
        String path = request.getUrl().getPath();
        if (range != null && path != null && path.startsWith(Bridge.CAPACITOR_FILE_START)) {
            WebResourceResponse partial = partial(new File(path.substring(Bridge.CAPACITOR_FILE_START.length())), range);
            if (partial != null) return partial;
        }
        return super.shouldInterceptRequest(view, request);
    }

    private WebResourceResponse partial(File file, String range) {
        try {
            File canonical = file.getCanonicalFile();
            if (!folder.getCanonicalPath().equals(canonical.getParent()) || !canonical.isFile()) return null;
            Matcher m = RANGE.matcher(range.trim());
            if (!m.matches()) return null;
            long size = canonical.length();
            long start, end;
            if (m.group(1).isEmpty()) { // the last N bytes
                if (m.group(2).isEmpty()) return null;
                start = Math.max(0, size - Long.parseLong(m.group(2)));
                end = size - 1;
            } else {
                start = Long.parseLong(m.group(1));
                end = m.group(2).isEmpty() ? size - 1 : Math.min(Long.parseLong(m.group(2)), size - 1);
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-cache");
            if (start >= size || start > end) {
                headers.put("Content-Range", "bytes */" + size);
                return new WebResourceResponse(mime(canonical), null, 416, "Range Not Satisfiable", headers, null);
            }
            long length = end - start + 1;
            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
            headers.put("Content-Length", String.valueOf(length));
            InputStream in = new FileInputStream(canonical);
            long skipped = 0;
            while (skipped < start) {
                long n = in.skip(start - skipped);
                if (n <= 0) break;
                skipped += n;
            }
            return new WebResourceResponse(mime(canonical), null, 206, "Partial Content", headers, new Limited(in, length));
        } catch (IOException | NumberFormatException e) {
            return null;
        }
    }

    private static String header(WebResourceRequest request, String name) {
        for (Map.Entry<String, String> h : request.getRequestHeaders().entrySet()) {
            if (h.getKey().equalsIgnoreCase(name)) return h.getValue();
        }
        return null;
    }

    private static String mime(File file) {
        String name = file.getName();
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return type != null ? type : "application/octet-stream";
    }

    /** At most `left` bytes of the stream. */
    private static final class Limited extends FilterInputStream {
        private long left;

        Limited(InputStream in, long left) {
            super(in);
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }
}
