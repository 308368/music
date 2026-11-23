package local.douyin.music;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.net.URI;

/** Commands arrive on WebView's bridge thread. Only the main thread touches the player or WebView. */
public final class AudioBridge {
    private final WebView web;
    private final URI origin;
    private final Handler main = new Handler(Looper.getMainLooper());
    private PlaybackService service;
    private boolean destroyed;
    private boolean ready;
    private String pendingClear;
    private String pendingUrl;
    private String pendingTitle;
    private String pendingArtist;
    private String pendingTicket;
    private Double pendingSeek;
    private Boolean pendingPlay;

    public AudioBridge(WebView web, String origin) {
        this.web = web;
        this.origin = URI.create(origin);
    }

    public void setService(PlaybackService next) {
        if (destroyed || next == service) return;
        if (service != null) service.setListener(null);
        service = next;
        if (next == null) {
            publish("disconnect");
            return;
        }
        next.setListener(this::publish);
        if (pendingClear != null) next.clear(pendingClear);
        if (pendingUrl != null) next.load(pendingUrl, pendingTitle, pendingArtist, pendingTicket);
        if (pendingSeek != null) next.seek(pendingSeek);
        if (Boolean.TRUE.equals(pendingPlay)) next.play();
        if (Boolean.FALSE.equals(pendingPlay)) next.pause();
        pendingClear = null;
        pendingUrl = null;
        pendingTitle = null;
        pendingArtist = null;
        pendingTicket = null;
        pendingSeek = null;
        pendingPlay = null;
        publish("sync");
    }

    public void destroy() {
        if (service != null) service.setListener(null);
        service = null;
        destroyed = true;
        main.removeCallbacksAndMessages(null);
    }

    @JavascriptInterface public void ready() {
        main.post(() -> {
            if (destroyed) return;
            ready = true;
            publish("sync");
        });
    }

    private void publish(String event) {
        if (!ready || destroyed) return;
        JSONObject state = service == null ? new JSONObject() : service.snapshot();
        String src = state.optString("src", "");
        if (!src.isEmpty() && mediaUrl(src) == null) return;
        web.evaluateJavascript("window.receiveNativeAudio && window.receiveNativeAudio("
                + JSONObject.quote(event) + "," + state + "," + JSONObject.quote(state.optString("ticket")) + ")", null);
    }

    private static int port(URI url) {
        return url.getPort() >= 0 ? url.getPort() : "https".equalsIgnoreCase(url.getScheme()) ? 443 : 80;
    }

    private String mediaUrl(String value) {
        if (value == null || value.length() > 2048) return null;
        try {
            URI url = origin.resolve(value);
            if (url.getHost() == null || origin.getHost() == null
                    || !("http".equalsIgnoreCase(url.getScheme()) || "https".equalsIgnoreCase(url.getScheme()))
                    || !origin.getScheme().equalsIgnoreCase(url.getScheme())
                    || !origin.getHost().equalsIgnoreCase(url.getHost()) || port(origin) != port(url)
                    || url.getRawUserInfo() != null || url.getRawFragment() != null
                    || !"/api/proxy".equals(url.getRawPath()) || url.getRawQuery() == null
                    || !url.getRawQuery().matches("id=[A-Za-z0-9_-]{6,20}")) return null;
            return url.toASCIIString();
        } catch (IllegalArgumentException invalidUri) {
            return null;
        }
    }

    private static String label(String value) {
        return value == null ? "" : value.substring(0, Math.min(value.length(), 256));
    }

    @JavascriptInterface public boolean load(String source, String title, String artist, String ticket) {
        String url = mediaUrl(source);
        if (url == null || !validTicket(ticket)) return false;
        main.post(() -> {
            if (destroyed) return;
            if (service != null) {
                service.load(url, label(title), label(artist), ticket);
            } else {
                pendingUrl = url;
                pendingTitle = label(title);
                pendingArtist = label(artist);
                pendingTicket = ticket;
                pendingSeek = null;
                pendingPlay = null;
            }
        });
        return true;
    }

    private static boolean validTicket(String ticket) {
        return ticket != null && ticket.matches("[a-z0-9-]{1,64}");
    }

    @JavascriptInterface public void clear(String ticket) {
        if (!validTicket(ticket)) return;
        main.post(() -> {
            if (destroyed) return;
            pendingUrl = null;
            pendingTitle = null;
            pendingArtist = null;
            pendingTicket = null;
            pendingSeek = null;
            pendingPlay = null;
            if (service == null) pendingClear = ticket;
            else service.clear(ticket);
        });
    }

    @JavascriptInterface public void setPlaying(boolean play) {
        main.post(() -> {
            if (destroyed) return;
            if (service == null) pendingPlay = play;
            else if (play) service.play();
            else service.pause();
        });
    }

    @JavascriptInterface public void seek(double seconds) {
        if (!Double.isFinite(seconds) || seconds < 0 || seconds > Integer.MAX_VALUE / 1000.0) return;
        main.post(() -> {
            if (destroyed) return;
            if (service == null) pendingSeek = seconds;
            else service.seek(seconds);
        });
    }
}
