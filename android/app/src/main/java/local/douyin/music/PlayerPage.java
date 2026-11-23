package local.douyin.music;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

final class PlayerPage extends WebViewClient {
    static final String HOME = "https://appassets.androidplatform.net/";
    private final Context context;
    private final Runnable openSettings;
    private final Runnable openMusicSource;

    PlayerPage(Context context, Runnable openSettings, Runnable openMusicSource) {
        this.context = context;
        this.openSettings = openSettings;
        this.openMusicSource = openMusicSource;
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (request.isForMainFrame() && request.getUrl().toString().equals(HOME + "network-settings")) {
            openSettings.run();
        }
        if (request.isForMainFrame() && request.hasGesture() && request.getUrl().toString().equals(HOME + "music-source")) {
            openMusicSource.run();
        }
        return true;
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!uri.toString().startsWith(HOME)) {
            if (!request.isForMainFrame() && "GET".equals(request.getMethod())
                    && "https".equals(uri.getScheme()) && "music.nekocore.cn".equals(uri.getEncodedAuthority())
                    && uri.getEncodedPath() != null && uri.getEncodedPath().matches("/api/music/cover/[1-9][0-9]{0,14}")) {
                return cover(uri);
            }
            return failure(403);
        }
        if (!"GET".equals(request.getMethod())) return failure(405);
        String path = uri.getEncodedPath();
        switch (path) {
            case "/":
            case "/index.html": return asset("index.html", "text/html");
            case "/css/app.css": return asset("css/app.css", "text/css");
            case "/mini-player.css": return asset("mini-player.css", "text/css");
            case "/phone-ui.css": return asset("phone-ui.css", "text/css");
            case "/phone-search.css": return asset("phone-search.css", "text/css");
            case "/phone-turntable.css": return asset("phone-turntable.css", "text/css");
            case "/js/api.js":
            case "/js/player.js":
            case "/js/app.js":
            case "/mini-player.js":
            case "/phone-home.js":
            case "/phone-search.js":
            case "/phone-player.js":
            case "/native-audio.js": return asset(path.substring(1), "application/javascript");
            case "/api/playlist":
            case "/api/playlist-detail":
            case "/api/search":
            case "/api/lyrics":
            case "/health":
                if (request.isForMainFrame()) return failure(403);
                try {
                    String result = PhoneMusic.request(context, path, uri.getEncodedQuery());
                    return json(200, result);
                } catch (RuntimeException error) {
                    android.util.Log.w("PhoneMusic", "Catalogue request failed: " + path, error);
                    return failure(503);
                }
            default: return failure(404);
        }
    }

    private WebResourceResponse cover(Uri uri) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(uri.toString()).openConnection(NetworkSettings.javaProxy(context));
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(7000);
            conn.setReadTimeout(12000);
            int status = conn.getResponseCode();
            String type = conn.getContentType();
            if (status != 200 || type == null || !type.startsWith("image/")) {
                conn.disconnect();
                return failure(404);
            }
            HttpURLConnection active = conn;
            return new WebResourceResponse(type.split(";")[0], null, 200, "OK",
                    Collections.singletonMap("Cache-Control", "private, max-age=86400"),
                    new FilterInputStream(conn.getInputStream()) {
                        @Override public void close() throws IOException {
                            try { super.close(); } finally { active.disconnect(); }
                        }
                    });
        } catch (IOException e) {
            if (conn != null) conn.disconnect();
            return failure(503);
        }
    }

    private WebResourceResponse asset(String path, String type) {
        try {
            Map<String, String> headers = new HashMap<>();
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                    + "style-src 'self' 'unsafe-inline'; img-src 'self' https://music.nekocore.cn data:; connect-src 'self'; "
                    + "object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
            return new WebResourceResponse(type, "UTF-8", 200, "OK", headers, context.getAssets().open(path));
        } catch (IOException e) { return failure(404); }
    }

    private static WebResourceResponse json(int code, String result) {
        return new WebResourceResponse("application/json", "UTF-8", code, code == 200 ? "OK" : "Unavailable",
                Collections.singletonMap("Cache-Control", "no-store"),
                new ByteArrayInputStream(result.getBytes(StandardCharsets.UTF_8)));
    }

    private static WebResourceResponse failure(int code) {
        return json(code, "{\"error\":\"无法获取音乐数据，请检查手机网络后重试\"}");
    }
}
