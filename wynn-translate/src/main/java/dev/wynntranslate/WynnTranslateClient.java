package dev.wynntranslate;

import com.mojang.blaze3d.platform.InputConstants;
import dev.wynntranslate.config.Language;
import dev.wynntranslate.config.ModConfig;
import dev.wynntranslate.dialogue.DialogueParser;
import dev.wynntranslate.dialogue.DialogueSnapshot;
import dev.wynntranslate.dialogue.DialogueTracker;
import dev.wynntranslate.dialogue.TextSegment;
import dev.wynntranslate.translate.TranslationService;
import dev.wynntranslate.ui.LanguageScreen;
import dev.wynntranslate.ui.TranslationOverlay;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.ChatFormatting;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class WynnTranslateClient implements ClientModInitializer {
    public static final String MOD_ID = "wynntranslate";
    public static final Logger LOGGER = LoggerFactory.getLogger("WynnTranslate");

    private static WynnTranslateClient instance;

    private ModConfig config;
    private TranslationService translations;
    private DialogueTracker tracker;
    private KeyMapping menuKey;
    private int joinPromptTicks = -1;
    private boolean openMenuNextTick;
    private int saveTicks;
    private String lastChatBody = "";

    @Override
    public void onInitializeClient() {
        instance = this;
        config = ModConfig.load();
        translations = new TranslationService(config, FabricLoader.getInstance().getConfigDir().resolve(MOD_ID).resolve("cache"));
        tracker = new DialogueTracker(this::onDialogueFinished);

        KeyMapping.Category category = KeyMapping.Category.register(Identifier.fromNamespaceAndPath(MOD_ID, "main"));
        menuKey = KeyBindingHelper.registerKeyBinding(
                new KeyMapping("key.wynntranslate.menu", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_L, category));

        ClientTickEvents.END_CLIENT_TICK.register(this::onTick);
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> {
            if (config.askOnJoin && isOnWynncraft(client)) joinPromptTicks = 60;
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> {
            tracker.clear();
            joinPromptTicks = -1;
            translations.save();
        });
        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> translations.shutdown());
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) ->
                dispatcher.register(ClientCommandManager.literal("wtranslate").executes(context -> {
                    openMenuNextTick = true;
                    return 1;
                })));

        TranslationOverlay overlay = new TranslationOverlay(this);
        HudElementRegistry.addLast(Identifier.fromNamespaceAndPath(MOD_ID, "overlay"), overlay::render);

        LOGGER.info("WynnTranslate geladen (Sprache: {})", config.language);
    }

    public static WynnTranslateClient get() {
        return instance;
    }

    public ModConfig config() {
        return config;
    }

    public TranslationService translations() {
        return translations;
    }

    public DialogueTracker tracker() {
        return tracker;
    }

    private void onTick(Minecraft client) {
        tracker.tick();

        while (menuKey.consumeClick()) {
            if (client.screen == null) client.setScreen(new LanguageScreen(null, false));
        }
        if (openMenuNextTick && client.screen == null) {
            openMenuNextTick = false;
            client.setScreen(new LanguageScreen(null, false));
        }
        if (joinPromptTicks > 0 && client.player != null && client.screen == null && --joinPromptTicks == 0) {
            client.setScreen(new LanguageScreen(null, true));
        }
        if (++saveTicks >= 20 * 60) {
            saveTicks = 0;
            translations.save();
        }
    }

    /** Wird vom Mixin für jede Systemnachricht (Chat und Aktionsleiste) auf dem Hauptthread aufgerufen. */
    public static void onSystemMessage(Component content, boolean actionBar) {
        if (instance != null) instance.handleSystemMessage(content, actionBar);
    }

    private void handleSystemMessage(Component content, boolean actionBar) {
        if (!config.isActive()) {
            if (actionBar) tracker.clear();
            return;
        }
        if (actionBar) {
            tracker.update(DialogueParser.parseActionBar(toSegments(content)));
            return;
        }
        if (config.translateChatDialogue && isOnWynncraft(Minecraft.getInstance())) {
            String[] line = DialogueParser.parseChatLine(content.getString());
            if (line != null) {
                Language language = config.language;
                translations.translate(language, line[1]).thenAccept(text ->
                        addChat(language, line[0] + ": " + text));
            }
        }
    }

    private void onDialogueFinished(DialogueSnapshot dialogue) {
        if (!config.isActive()) return;
        Language language = config.language;
        for (String choice : dialogue.choices()) translations.translate(language, choice);

        String body = dialogue.body();
        translations.translate(language, body).thenAccept(text -> Minecraft.getInstance().execute(() -> {
            if (!config.showInChat || body.equals(lastChatBody)) return;
            lastChatBody = body;
            addChat(language, text);
        }));
    }

    private void addChat(Language language, String text) {
        Minecraft client = Minecraft.getInstance();
        client.execute(() -> {
            if (client.player == null) return;
            String shown = language.rightToLeft() ? client.font.bidirectionalShaping(text) : text;
            client.gui.getChat().addMessage(Component.empty()
                    .append(Component.literal("[" + language.googleCode().toUpperCase(Locale.ROOT) + "] ")
                            .withStyle(ChatFormatting.DARK_AQUA))
                    .append(Component.literal(shown).withStyle(ChatFormatting.GRAY)));
        });
    }

    private static List<TextSegment> toSegments(Component component) {
        List<TextSegment> segments = new ArrayList<>();
        component.visit((style, text) -> {
            String path = style.getFont() instanceof FontDescription.Resource(Identifier id) ? id.getPath() : "";
            segments.add(new TextSegment(path, text));
            return Optional.empty();
        }, Style.EMPTY);
        return segments;
    }

    public static boolean isOnWynncraft(Minecraft client) {
        ServerData server = client.getCurrentServer();
        return server != null && server.ip != null && server.ip.toLowerCase(Locale.ROOT).contains("wynncraft");
    }
}
