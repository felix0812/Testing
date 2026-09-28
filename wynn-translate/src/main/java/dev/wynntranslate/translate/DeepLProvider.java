package dev.wynntranslate.translate;

import com.google.gson.JsonObject;
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
import java.util.function.Supplier;

/** DeepL-API (kostenloser oder bezahlter Schlüssel). Schlüssel für die Free-API enden auf ":fx". */
public class DeepLProvider implements TranslationProvider {
    private final HttpClient http;
    private final Supplier<String> key;

    public DeepLProvider(HttpClient http, Supplier<String> key) {
        this.http = http;
        this.key = key;
    }

    public boolean supports(Language language) {
        return language.deeplCode() != null && !key.get().isBlank();
    }

    @Override
    public String translate(String text, Language target) throws IOException, InterruptedException {
        String apiKey = key.get().trim();
        String host = apiKey.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
        String form = "source_lang=EN&target_lang=" + target.deeplCode()
                + "&text=" + URLEncoder.encode(text, StandardCharsets.UTF_8);
        HttpRequest request = HttpRequest.newBuilder(URI.create(host + "/v2/translate"))
                .timeout(Duration.ofSeconds(10))
                .header("Authorization", "DeepL-Auth-Key " + apiKey)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(form))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() != 200) {
            throw new IOException("DeepL antwortete mit HTTP " + response.statusCode());
        }
        try {
            JsonObject json = JsonParser.parseString(response.body()).getAsJsonObject();
            return json.getAsJsonArray("translations").get(0).getAsJsonObject().get("text").getAsString().trim();
        } catch (RuntimeException e) {
            throw new IOException("Unerwartete Antwort von DeepL", e);
        }
    }
}
