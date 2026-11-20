package local.douyin.music;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.view.WindowInsets;
import android.webkit.WebView;
import android.widget.FrameLayout;

public final class MainActivity extends Activity {
    private FrameLayout root;
    private WebView web;
    private AudioBridge bridge;
    private PlaybackService playback;
    private boolean bound;
    private final ServiceConnection connection = new ServiceConnection() {
        public void onServiceConnected(ComponentName name, IBinder binder) {
            playback = ((PlaybackService.LocalBinder) binder).service();
            if (bridge != null) bridge.setService(playback);
        }
        public void onServiceDisconnected(ComponentName name) {
            playback = null;
            if (bridge != null) bridge.setService(null);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(11, 11, 15));
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);
        openPlayer();
        bound = bindService(new Intent(this, PlaybackService.class), connection, Context.BIND_AUTO_CREATE);
    }

    private void openPlayer() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(11, 11, 15));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new PlayerPage(getApplicationContext(), () ->
            NetworkSettings.show(this, () -> {
                if (playback == null) web.reload();
                else playback.networkChanged(() -> { if (!isDestroyed()) web.reload(); });
            }), this::openMusicSource));
        bridge = new AudioBridge(web, PlayerPage.HOME);
        if (playback != null) bridge.setService(playback);
        web.addJavascriptInterface(bridge, "AndroidAudio");
        root.addView(web);
        web.loadUrl(PlayerPage.HOME);
    }

    private void openMusicSource() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://github.com/FantasyNetworkCN/NekoMusicDocs")));
        } catch (ActivityNotFoundException e) {
            android.widget.Toast.makeText(this, "未找到可以打开音源文档的浏览器", android.widget.Toast.LENGTH_SHORT).show();
        }
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    private void disposePage() {
        bridge.destroy();
        web.removeJavascriptInterface("AndroidAudio");
        web.stopLoading();
        root.removeView(web);
        web.destroy();
    }

    @Override protected void onDestroy() {
        if (web != null) disposePage();
        if (bound) unbindService(connection);
        super.onDestroy();
    }
}
