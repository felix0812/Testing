package dev.wynntranslate.ui;

import dev.wynntranslate.WynnTranslateClient;
import dev.wynntranslate.config.Language;
import dev.wynntranslate.config.ModConfig;
import dev.wynntranslate.dialogue.DialogueSnapshot;
import dev.wynntranslate.translate.TranslationService;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;

/** Zeichnet die Übersetzung des aktuellen NPC-Dialogs als Kasten auf den Bildschirm. */
public class TranslationOverlay {
    private static final int PADDING = 6;
    private static final int LINE_HEIGHT = 10;
    private static final int BACKGROUND = 0xC8101014;
    private static final int BORDER = 0xFF3F7F5F;
    private static final int HEADER_COLOR = 0xFF8FBFA8;
    private static final int TEXT_COLOR = 0xFFFFFFFF;
    private static final int CHOICE_COLOR = 0xFFFFD37A;
    private static final int MUTED_COLOR = 0xFFA0A0A0;

    private final WynnTranslateClient mod;

    public TranslationOverlay(WynnTranslateClient mod) {
        this.mod = mod;
    }

    public void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
        Minecraft client = Minecraft.getInstance();
        ModConfig config = mod.config();
        DialogueSnapshot dialogue = mod.tracker().current();
        if (client.options.hideGui || !config.isActive() || dialogue == null || dialogue.body().isEmpty()) return;

        Language language = config.language;
        TranslationService translations = mod.translations();
        Optional<String> translated = translations.cached(language, dialogue.body());
        // Während der Text noch getippt wird, nichts anzeigen, außer er ist schon bekannt
        if (translated.isEmpty() && !mod.tracker().isFinished()) return;

        Font font = client.font;
        String body;
        int bodyColor = TEXT_COLOR;
        if (translated.isPresent()) {
            body = translated.get();
        } else if (translations.hasFailed(language, dialogue.body())) {
            body = Component.translatable("wynntranslate.overlay.failed").getString();
            bodyColor = MUTED_COLOR;
        } else {
            body = Component.translatable("wynntranslate.overlay.pending").getString();
            bodyColor = MUTED_COLOR;
        }

        int screenWidth = graphics.guiWidth();
        int screenHeight = graphics.guiHeight();
        int boxWidth = Math.min(screenWidth - 20, 320);
        int textWidth = boxWidth - 2 * PADDING;

        List<Line> lines = new ArrayList<>();
        for (String line : wrap(font, body, textWidth)) lines.add(new Line(line, bodyColor));
        for (String choice : dialogue.choices()) {
            String text = translations.cached(language, choice).orElse(choice);
            List<String> wrapped = wrap(font, "› " + text, textWidth);
            for (String line : wrapped) lines.add(new Line(line, CHOICE_COLOR));
        }

        int boxHeight = PADDING * 2 + LINE_HEIGHT + 2 + lines.size() * LINE_HEIGHT;
        int x = (screenWidth - boxWidth) / 2;
        int y = switch (config.overlayPosition) {
            case TOP -> 24;
            case CENTER -> (screenHeight - boxHeight) / 2 - 30;
            case BOTTOM -> screenHeight - 60 - boxHeight;
        };

        graphics.fill(x, y, x + boxWidth, y + boxHeight, BACKGROUND);
        graphics.fill(x, y, x + boxWidth, y + 1, BORDER);
        graphics.fill(x, y + boxHeight - 1, x + boxWidth, y + boxHeight, BORDER);
        graphics.fill(x, y, x + 1, y + boxHeight, BORDER);
        graphics.fill(x + boxWidth - 1, y, x + boxWidth, y + boxHeight, BORDER);

        String header = "WynnTranslate · " + shape(font, language.nativeName(), language);
        graphics.drawString(font, header, x + PADDING, y + PADDING, HEADER_COLOR, false);

        int lineY = y + PADDING + LINE_HEIGHT + 2;
        for (Line line : lines) {
            String shown = shape(font, line.text(), language);
            int lineX = language.rightToLeft() ? x + boxWidth - PADDING - font.width(shown) : x + PADDING;
            graphics.drawString(font, shown, lineX, lineY, line.color(), true);
            lineY += LINE_HEIGHT;
        }
    }

    /** Bricht Text an Wortgrenzen um; zu lange Wörter (z. B. Chinesisch ohne Leerzeichen) werden zeichenweise geteilt. */
    static List<String> wrap(Font font, String text, int maxWidth) {
        List<String> lines = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split(" ")) {
            String candidate = line.isEmpty() ? word : line + " " + word;
            if (font.width(candidate) <= maxWidth) {
                line.setLength(0);
                line.append(candidate);
                continue;
            }
            if (!line.isEmpty()) {
                lines.add(line.toString());
                line.setLength(0);
            }
            for (int offset = 0; offset < word.length(); ) {
                int codePoint = word.codePointAt(offset);
                String next = line + new String(Character.toChars(codePoint));
                if (font.width(next) > maxWidth && !line.isEmpty()) {
                    lines.add(line.toString());
                    line.setLength(0);
                    continue;
                }
                line.setLength(0);
                line.append(next);
                offset += Character.charCount(codePoint);
            }
        }
        if (!line.isEmpty()) lines.add(line.toString());
        return lines;
    }

    /** Arabisch und Urdu: Buchstaben verbinden und von rechts nach links anordnen. */
    public static String shape(Font font, String text, Language language) {
        return language.rightToLeft() ? font.bidirectionalShaping(text) : text;
    }

    private record Line(String text, int color) {}
}
