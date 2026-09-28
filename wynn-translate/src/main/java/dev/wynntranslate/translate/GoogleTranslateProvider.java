package dev.wynntranslate.translate;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import dev.wynntranslate.config.Language;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** Kostenloser Google-Translate-Endpunkt (ohne API-Schlüssel). */
public class GoogleTranslateProvider implements TranslationProvider {
    private static final String ENDPOINT = "https://translate.googleapis.com/translate_a/single";

    private final HttpClient http;

    public GoogleTranslateProvider(HttpClient http) {
        this.http = http;
    }

    @Override
    public String translate(String text, Language target) throws IOException, InterruptedException {
        String url = ENDPOINT + "?client=gtx&sl=en&dt=t&tl=" + target.googleCode()
                + "&q=" + URLEncoder.encode(text, StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("User-Agent", "Mozilla/5.0 (WynnTranslate Minecraft mod)")
                .GET()
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200) {
            throw new IOException("Google Translate antwortete mit HTTP " + response.statusCode());
        }
        return parseResponse(response.body());
    }

    /** Die Antwort ist ein verschachteltes Array: [[["Übersetzung","Original",...], ...], ...]. */
    static String parseResponse(String body) throws IOException {
        try {
            JsonArray sentences = JsonParser.parseString(body).getAsJsonArray().get(0).getAsJsonArray();
            StringBuilder out = new StringBuilder();
            for (JsonElement sentence : sentences) {
                JsonElement part = sentence.getAsJsonArray().get(0);
                if (part != null && !part.isJsonNull()) out.append(part.getAsString());
            }
            String result = out.toString().trim();
            if (result.isEmpty()) throw new IOException("Leere Übersetzung");
            return result;
        } catch (RuntimeException e) {
            throw new IOException("Unerwartete Antwort von Google Translate", e);
        }
    }
}
