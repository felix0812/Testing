package dev.wynntranslate.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import dev.wynntranslate.WynnTranslateClient;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;

public class ModConfig {
    public enum Provider { GOOGLE, DEEPL }

    public enum OverlayPosition { TOP, CENTER, BOTTOM }

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path FILE = FabricLoader.getInstance().getConfigDir().resolve("wynntranslate.json");

    public Language language = Language.ORIGINAL;
    public boolean enabled = true;
    public boolean askOnJoin = true;
    public boolean showInChat = true;
    public boolean translateChatDialogue = true;
    public OverlayPosition overlayPosition = OverlayPosition.TOP;
    public Provider provider = Provider.GOOGLE;
    public String deeplKey = "";

    public boolean isActive() {
        return enabled && language != null && language.translates();
    }

    public static ModConfig load() {
        if (Files.exists(FILE)) {
            try (Reader reader = Files.newBufferedReader(FILE, StandardCharsets.UTF_8)) {
                ModConfig config = GSON.fromJson(reader, ModConfig.class);
                if (config != null) {
                    if (config.language == null) config.language = Language.ORIGINAL;
                    if (config.provider == null) config.provider = Provider.GOOGLE;
                    if (config.overlayPosition == null) config.overlayPosition = OverlayPosition.TOP;
                    if (config.deeplKey == null) config.deeplKey = "";
                    return config;
                }
            } catch (Exception e) {
                WynnTranslateClient.LOGGER.warn("Konfiguration konnte nicht gelesen werden, nutze Standardwerte", e);
            }
        }
        return new ModConfig();
    }

    public void save() {
        try {
            Files.createDirectories(FILE.getParent());
            try (Writer writer = Files.newBufferedWriter(FILE, StandardCharsets.UTF_8)) {
                GSON.toJson(this, writer);
            }
        } catch (IOException e) {
            WynnTranslateClient.LOGGER.warn("Konfiguration konnte nicht gespeichert werden", e);
        }
    }
}
