package dev.wynntranslate.translate;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import dev.wynntranslate.WynnTranslateClient;
import dev.wynntranslate.config.Language;
import dev.wynntranslate.config.ModConfig;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.lang.reflect.Type;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Übersetzt Texte im Hintergrund und merkt sich Ergebnisse dauerhaft pro Sprache. NPC-Texte
 * wiederholen sich oft, dadurch erscheinen bekannte Dialoge sofort und ohne Internetanfrage.
 */
public class TranslationService {
    private static final Type CACHE_TYPE = new TypeToken<Map<String, String>>() {}.getType();
    private static final Gson GSON = new Gson();

    private final ModConfig config;
    private final Path cacheDir;
    private final ExecutorService executor = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "WynnTranslate-Worker");
        thread.setDaemon(true);
        return thread;
    });
    private final GoogleTranslateProvider google;
    private final DeepLProvider deepl;
    private final Map<Language, Map<String, String>> caches = new EnumMap<>(Language.class);
    private final Map<String, CompletableFuture<String>> inFlight = new ConcurrentHashMap<>();
    private final Set<String> failed = ConcurrentHashMap.newKeySet();
    private final Set<Language> dirty = ConcurrentHashMap.newKeySet();

    public TranslationService(ModConfig config, Path cacheDir) {
        this.config = config;
        this.cacheDir = cacheDir;
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).build();
        this.google = new GoogleTranslateProvider(http);
        this.deepl = new DeepLProvider(http, () -> config.deeplKey == null ? "" : config.deeplKey);
    }

    public static String normalize(String text) {
        return text.trim().replaceAll("\\s+", " ");
    }

    /** Bereits bekannte Übersetzung, ohne eine Anfrage auszulösen. */
    public Optional<String> cached(Language language, String text) {
        return Optional.ofNullable(cache(language).get(normalize(text)));
    }

    public boolean hasFailed(Language language, String text) {
        return failed.contains(key(language, normalize(text)));
    }

    /** Übersetzt asynchron; gleiche gleichzeitige Anfragen werden zusammengelegt. */
    public CompletableFuture<String> translate(Language language, String text) {
        String source = normalize(text);
        if (!language.translates() || source.isEmpty()) return CompletableFuture.completedFuture(source);

        String hit = cache(language).get(source);
        if (hit != null) return CompletableFuture.completedFuture(hit);

        String key = key(language, source);
        failed.remove(key);
        CompletableFuture<String> future = inFlight.computeIfAbsent(key, k -> CompletableFuture.supplyAsync(() -> {
            try {
                String result = provider(language).translate(source, language);
                cache(language).put(source, result);
                dirty.add(language);
                return result;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                failed.add(k);
                throw new IllegalStateException(e);
            } catch (IOException e) {
                failed.add(k);
                WynnTranslateClient.LOGGER.warn("Übersetzung fehlgeschlagen: {}", e.getMessage());
                throw new IllegalStateException(e);
            }
        }, executor));
        future.whenComplete((result, error) -> inFlight.remove(key, future));
        return future;
    }

    private TranslationProvider provider(Language language) {
        if (config.provider == ModConfig.Provider.DEEPL && deepl.supports(language)) return deepl;
        return google;
    }

    private static String key(Language language, String source) {
        return language.name() + '\u0000' + source;
    }

    private Map<String, String> cache(Language language) {
        synchronized (caches) {
            return caches.computeIfAbsent(language, this::loadCache);
        }
    }

    private Map<String, String> loadCache(Language language) {
        Map<String, String> map = new ConcurrentHashMap<>();
        Path file = cacheFile(language);
        if (Files.exists(file)) {
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                Map<String, String> stored = GSON.fromJson(reader, CACHE_TYPE);
                if (stored != null) map.putAll(stored);
            } catch (Exception e) {
                WynnTranslateClient.LOGGER.warn("Übersetzungs-Cache {} unlesbar, starte leer", file, e);
            }
        }
        return map;
    }

    private Path cacheFile(Language language) {
        return cacheDir.resolve(language.googleCode() + ".json");
    }

    /** Schreibt geänderte Caches auf die Festplatte. */
    public void save() {
        for (Language language : Set.copyOf(dirty)) {
            dirty.remove(language);
            Map<String, String> map;
            synchronized (caches) {
                map = caches.get(language);
            }
            if (map == null) continue;
            try {
                Files.createDirectories(cacheDir);
                Path tmp = cacheDir.resolve(language.googleCode() + ".json.tmp");
                try (Writer writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
                    GSON.toJson(Map.copyOf(map), CACHE_TYPE, writer);
                }
                Files.move(tmp, cacheFile(language), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (IOException e) {
                WynnTranslateClient.LOGGER.warn("Übersetzungs-Cache konnte nicht gespeichert werden", e);
            }
        }
    }

    public void clearCache() {
        synchronized (caches) {
            caches.clear();
        }
        failed.clear();
        dirty.clear();
        try (var files = Files.list(cacheDir)) {
            for (Path file : files.toList()) Files.deleteIfExists(file);
        } catch (IOException ignored) {
            // Ordner existiert noch nicht
        }
    }

    public void shutdown() {
        save();
        executor.shutdownNow();
    }
}
