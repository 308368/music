package local.douyin.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONException;
import org.json.JSONObject;

/** A bound service owns the decoder. Active playback also owns a foreground notification. */
public final class PlaybackService extends Service {
    public interface Listener { void onEvent(String event); }
    public final class LocalBinder extends Binder {
        public PlaybackService service() { return PlaybackService.this; }
    }

    private static final String CHANNEL = "playback";
    private static final int NOTICE = 101;
    private final LocalBinder binder = new LocalBinder();
    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread thread;
    private Handler worker;
    private Listener listener;
    private JSONObject status = new JSONObject();
    private volatile boolean destroyed;
    private MediaSession session;
    private AudioManager manager;
    private AudioFocusRequest focus;
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();

    // The following decoder and playback state are owned by the audio thread.
    private MediaPlayer decoder;
    private boolean prepared, wantsPlay, ended, buffering, foreground, hasFocus, resumeOnGain;
    private long pendingSeek = -1;
    private String source = "", title = "", artist = "";

    @Override public void onCreate() {
        super.onCreate();
        thread = new HandlerThread("music-playback");
        thread.start();
        worker = new Handler(thread.getLooper());
        getSystemService(NotificationManager.class).createNotificationChannel(
            new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW));
        manager = getSystemService(AudioManager.class);
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes).setOnAudioFocusChangeListener(this::focusChanged, worker).build();
        session = new MediaSession(this, "Music");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { playOnWorker(); }
            @Override public void onPause() { pauseOnWorker(false); }
            @Override public void onSeekTo(long millis) { seekOnWorker(millis); }
            @Override public void onSkipToNext() { emit("nexttrack"); }
            @Override public void onSkipToPrevious() { emit("previoustrack"); }
            @Override public void onStop() { pauseOnWorker(false); }
        }, worker);
        registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    }

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { pause(); }
    };
    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (action != null) worker.post(() -> {
            switch (action) {
                case "play": playOnWorker(); break;
                case "pause": pauseOnWorker(false); break;
                case "next": emit("nexttrack"); break;
                case "previous": emit("previoustrack"); break;
            }
        });
        return START_NOT_STICKY;
    }

    public void setListener(Listener next) { listener = next; }
    public JSONObject snapshot() { return status; }
    public void load(String url, String name, String performer) {
        worker.post(() -> loadOnWorker(url, name, performer));
    }
    public void play() { worker.post(this::playOnWorker); }
    public void pause() { worker.post(() -> pauseOnWorker(false)); }
    public void networkChanged(Runnable done) {
        worker.post(() -> {
            releaseDecoder();
            wantsPlay = ended = resumeOnGain = false;
            source = "";
            pendingSeek = -1;
            emit("disconnect");
            updateSession();
            idle.run();
            getSystemService(NotificationManager.class).cancel(NOTICE);
            main.post(done);
        });
    }
    public void seek(double seconds) {
        if (Double.isFinite(seconds)) worker.post(() -> seekOnWorker(Math.max(0, (long)(seconds * 1000))));
    }

    private void loadOnWorker(String url, String name, String performer) {
        releaseDecoder();
        wantsPlay = ended = buffering = resumeOnGain = false;
        pendingSeek = -1;
        source = url;
        title = name;
        artist = performer;
        MediaPlayer created = new MediaPlayer();
        decoder = created;
        try {
            created.setAudioAttributes(attributes);
            created.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            created.setOnPreparedListener(p -> {
                if (p != decoder) return;
                prepared = true;
                if (pendingSeek >= 0) seekOnWorker(pendingSeek);
                emit("loadedmetadata");
                emit("durationchange");
                emit("canplay");
                if (wantsPlay) playOnWorker();
                else updateSession();
            });
            created.setOnSeekCompleteListener(p -> {
                if (p == decoder) { pendingSeek = -1; emit("seeked"); updateSession(); }
            });
            created.setOnInfoListener((p, what, extra) -> {
                if (p == decoder && (what == MediaPlayer.MEDIA_INFO_BUFFERING_START
                        || what == MediaPlayer.MEDIA_INFO_BUFFERING_END)) {
                    buffering = what == MediaPlayer.MEDIA_INFO_BUFFERING_START;
                    emit(buffering ? "waiting" : "canplay");
                    updateSession();
                }
                return false;
            });
            created.setOnCompletionListener(p -> {
                if (p != decoder) return;
                ended = true;
                wantsPlay = false;
                worker.removeCallbacks(tick);
                emit("ended");
                updateSession();
                // Allow the queue to load its next track without relinquishing foreground priority.
                worker.postDelayed(idle, 2000);
            });
            created.setOnErrorListener((p, what, extra) -> {
                if (p == decoder) fail();
                return true;
            });
            emit("load");
            created.setDataSource(PhoneMusic.playbackUrl(this, url, name, performer));
            created.prepareAsync();
            updateSession();
            worker.postDelayed(idle, 2000);
        } catch (Exception error) { fail(); }
    }

    private void playOnWorker() {
        if (destroyed || source.isEmpty()) return;
        if (decoder == null) {
            loadOnWorker(source, title, artist);
            if (decoder == null) return;
        }
        try {
            worker.removeCallbacks(idle);
            wantsPlay = true;
            ended = false;
            updateSession();
            if (!foreground) {
                startForeground(NOTICE, notification());
                foreground = true;
                startService(new Intent(this, PlaybackService.class));
            }
            if (!hasFocus) {
                hasFocus = manager.requestAudioFocus(focus) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
                if (hasFocus) decoder.setVolume(1f, 1f);
            }
            if (!hasFocus) { pauseOnWorker(false); return; }
            if (prepared) {
                decoder.start();
                worker.removeCallbacks(tick);
                worker.post(tick);
                emit("play");
            } else emit("waiting");
            updateSession();
        } catch (RuntimeException failure) { fail(); }
    }

    private void pauseOnWorker(boolean transientLoss) {
        resumeOnGain = transientLoss && wantsPlay;
        wantsPlay = false;
        if (prepared && decoder.isPlaying()) decoder.pause();
        worker.removeCallbacks(tick);
        emit("pause");
        updateSession();
        if (!resumeOnGain) idle.run();
    }

    private void seekOnWorker(long millis) {
        if (decoder == null) return;
        ended = false;
        pendingSeek = prepared ? Math.min(millis, Math.max(0, decoder.getDuration())) : millis;
        if (prepared) decoder.seekTo(pendingSeek, MediaPlayer.SEEK_CLOSEST);
    }

    private void focusChanged(int change) {
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            if (!hasFocus) return;
            if (decoder != null) decoder.setVolume(1f, 1f);
            if (resumeOnGain) { resumeOnGain = false; playOnWorker(); }
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            if (decoder != null) decoder.setVolume(.2f, .2f);
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (wantsPlay) pauseOnWorker(true);
        } else if (change == AudioManager.AUDIOFOCUS_LOSS) pauseOnWorker(false);
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!wantsPlay || !prepared || destroyed) return;
            emit("timeupdate");
            worker.postDelayed(this, 500);
        }
    };
    private final Runnable idle = () -> {
        if (wantsPlay || resumeOnGain) return;
        if (hasFocus) { manager.abandonAudioFocusRequest(focus); hasFocus = false; }
        if (foreground) {
            stopForeground(STOP_FOREGROUND_DETACH);
            foreground = false;
            stopSelf();
        }
    };

    private long position() {
        if (pendingSeek >= 0) return pendingSeek;
        return prepared ? Math.max(0, decoder.getCurrentPosition()) : 0;
    }
    private void emit(String event) {
        JSONObject state = new JSONObject();
        try {
            state.put("src", source).put("currentTime", position() / 1000.0)
                .put("duration", prepared ? Math.max(0, decoder.getDuration()) / 1000.0 : 0)
                .put("paused", !wantsPlay).put("readyState", prepared ? (buffering ? 2 : 4) : 0)
                .put("ended", ended);
        } catch (JSONException impossible) { throw new AssertionError(impossible); }
        main.post(() -> {
            if (destroyed) return;
            status = state;
            if (listener != null) listener.onEvent(event);
        });
    }

    private void updateSession() {
        if (destroyed) return;
        session.setActive(decoder != null);
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist);
        if (prepared) metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, decoder.getDuration());
        session.setMetadata(metadata.build());
        int state = wantsPlay ? (prepared && !buffering ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_BUFFERING)
            : ended ? PlaybackState.STATE_STOPPED : PlaybackState.STATE_PAUSED;
        session.setPlaybackState(new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY |
            PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO |
            PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS)
            .setState(state, position(), state == PlaybackState.STATE_PLAYING ? 1f : 0f).build());
        if (foreground) getSystemService(NotificationManager.class).notify(NOTICE, notification());
    }

    private PendingIntent command(String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);
    }
    private Notification notification() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(title).setContentText(artist)
            .setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(wantsPlay)
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .addAction(android.R.drawable.ic_media_previous, "上一首", command("previous"))
            .addAction(wantsPlay ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                wantsPlay ? "暂停" : "播放", command(wantsPlay ? "pause" : "play"))
            .addAction(android.R.drawable.ic_media_next, "下一首", command("next"));
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) builder.setContentIntent(PendingIntent.getActivity(this, 0,
            launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE));
        return builder.build();
    }

    private void fail() {
        releaseDecoder();
        wantsPlay = ended = resumeOnGain = false;
        pendingSeek = -1;
        emit("error");
        updateSession();
        idle.run();
        getSystemService(NotificationManager.class).cancel(NOTICE);
    }
    private void releaseDecoder() {
        worker.removeCallbacks(tick);
        worker.removeCallbacks(idle);
        prepared = false;
        if (decoder != null) { decoder.release(); decoder = null; }
    }
    @Override public void onDestroy() {
        destroyed = true;
        listener = null;
        unregisterReceiver(noisy);
        worker.removeCallbacksAndMessages(null);
        worker.post(() -> {
            releaseDecoder();
            if (hasFocus) manager.abandonAudioFocusRequest(focus);
            session.release();
            thread.quitSafely();
        });
        stopForeground(STOP_FOREGROUND_REMOVE);
        getSystemService(NotificationManager.class).cancel(NOTICE);
        super.onDestroy();
    }
}
