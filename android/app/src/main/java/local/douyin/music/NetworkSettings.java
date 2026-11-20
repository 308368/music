package local.douyin.music;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.text.InputType;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.URI;

final class NetworkSettings {
    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("phone_network", Context.MODE_PRIVATE);
    }

    static String proxyUrl(Context context) {
        return prefs(context).getString("active_proxy", "");
    }

    static Proxy javaProxy(Context context) {
        String value = proxyUrl(context);
        if (value.isEmpty()) return Proxy.NO_PROXY;
        URI uri = URI.create(value);
        return new Proxy(Proxy.Type.HTTP, new InetSocketAddress(uri.getHost(), uri.getPort()));
    }

    static void show(Activity owner, Runnable networkChanged) {
        SharedPreferences preferences = prefs(owner);
        ScrollView scroll = new ScrollView(owner);
        LinearLayout fields = new LinearLayout(owner);
        fields.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(20 * owner.getResources().getDisplayMetrics().density);
        fields.setPadding(pad, pad / 2, pad, pad / 2);
        scroll.addView(fields);
        Switch enabled = new Switch(owner);
        enabled.setText("使用 HTTP 代理");
        enabled.setChecked(!proxyUrl(owner).isEmpty());
        fields.addView(enabled);
        TextView hint = new TextView(owner);
        hint.setText("代理软件运行在本机时，地址填 127.0.0.1，端口填软件显示的 HTTP 或混合端口。使用全设备 VPN 时可关闭此项。");
        fields.addView(hint);
        EditText host = field(owner, fields, "代理地址", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        host.setText(preferences.getString("host", "127.0.0.1"));
        EditText port = field(owner, fields, "代理端口", InputType.TYPE_CLASS_NUMBER);
        port.setText(preferences.getString("port", ""));
        port.setHint("例如 7890");
        host.setEnabled(enabled.isChecked());
        port.setEnabled(enabled.isChecked());
        enabled.setOnCheckedChangeListener((button, checked) -> {
            host.setEnabled(checked);
            port.setEnabled(checked);
        });
        AlertDialog dialog = new AlertDialog.Builder(owner).setTitle("网络设置")
                .setView(scroll).setPositiveButton("保存", null).setNegativeButton("取消", null).create();
        dialog.show();
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            String name = host.getText().toString().trim();
            String digits = port.getText().toString().trim();
            String endpoint = "";
            if (enabled.isChecked()) {
                int number;
                try { number = Integer.parseInt(digits); } catch (NumberFormatException e) { number = 0; }
                if (number < 1 || number > 65535) {
                    port.setError("端口范围为 1 到 65535");
                    port.requestFocus();
                    return;
                }
                try {
                    // Host and port are entered separately. URI also normalizes bare IPv6 literals.
                    URI uri = new URI("http", null, name, number, null, null, null);
                    if (name.isEmpty() || uri.getHost() == null || uri.getPort() != number
                            || uri.getUserInfo() != null || !uri.getPath().isEmpty() || uri.getQuery() != null
                            || uri.getFragment() != null) throw new IllegalArgumentException();
                    endpoint = uri.toASCIIString();
                } catch (Exception e) {
                    host.setError("只填写主机名或 IP 地址");
                    host.requestFocus();
                    return;
                }
            }
            boolean changed = !endpoint.equals(proxyUrl(owner));
            preferences.edit().putString("active_proxy", endpoint).putString("host", name)
                    .putString("port", digits).apply();
            dialog.dismiss();
            if (changed) networkChanged.run();
        });
    }

    private static EditText field(Activity owner, LinearLayout fields, String title, int type) {
        TextView label = new TextView(owner);
        label.setText(title);
        fields.addView(label);
        EditText input = new EditText(owner);
        input.setSingleLine(true);
        input.setInputType(type);
        input.setId(android.view.View.generateViewId());
        label.setLabelFor(input.getId());
        fields.addView(input);
        return input;
    }
}
