package local.douyin.music;

import android.content.Context;
import android.net.Uri;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;

import java.time.LocalDate;

final class PhoneMusic {
    private static PyObject provider;

    private static synchronized PyObject provider(Context context) {
        if (provider == null) {
            if (!Python.isStarted()) Python.start(new AndroidPlatform(context.getApplicationContext()));
            provider = Python.getInstance().getModule("phone_music");
        }
        return provider;
    }

    static String request(Context context, String path, String query) {
        String today = LocalDate.now().toString();
        return provider(context).callAttr("api", path, query == null ? "" : query,
                NetworkSettings.proxyUrl(context), today, context.getCacheDir().getAbsolutePath()).toString();
    }

    static String playbackUrl(Context context, String source, String title, String artist) {
        String id = Uri.parse(source).getQueryParameter("id");
        return provider(context).callAttr("playback_url", id, NetworkSettings.proxyUrl(context), title, artist).toString();
    }
}
