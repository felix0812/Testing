package dev.wynntranslate.dialogue;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Erkennt Wynncraft-NPC-Dialoge.
 *
 * <p>Wynncraft zeichnet Dialoge in der Aktionsleiste mit eigenen Schriftarten unter {@code hud/dialogue/}:
 * Textzeilen nutzen {@code .../body_N}, Antworten {@code .../choice...} und der "Shift"-Hinweis
 * {@code hud/dialogue/text/control}. Die Erkennung folgt dem Ansatz von Wynntils.
 */
public final class DialogueParser {
    private static final String DIALOGUE_FONT_PREFIX = "hud/dialogue/";
    private static final String FADE_FONT_PREFIX = "hud/dialogue/effect/fade";
    private static final String CONTROL_FONT = "hud/dialogue/text/control";
    private static final String BODY_MARKER = "/body_";
    private static final String CHOICE_MARKER = "/choice";
    /** Hoher Surrogat eines Wynncraft-Abstandszeichens; das folgende Zeichen gehört dazu. */
    private static final char POSITION_MARKER = '\uDAFF';

    /** Älteres Chat-Format: "[1/4] Name: Text". */
    private static final Pattern CHAT_DIALOGUE = Pattern.compile("^\\s*\\[(\\d+)/(\\d+)]\\s*([^:]{1,40}):\\s*(.+)$");

    private DialogueParser() {}

    /** Liefert den Dialog aus der Aktionsleiste oder {@code null}, wenn gerade keiner angezeigt wird. */
    public static DialogueSnapshot parseActionBar(List<TextSegment> segments) {
        StringBuilder body = new StringBuilder();
        Map<String, StringBuilder> choices = new LinkedHashMap<>();
        boolean found = false;
        boolean requiresShift = false;
        String lastBodyFont = null;

        for (TextSegment segment : segments) {
            String path = segment.fontPath();
            if (path == null || !path.startsWith(DIALOGUE_FONT_PREFIX) || path.startsWith(FADE_FONT_PREFIX)) continue;
            found = true;

            if (path.equals(CONTROL_FONT)) {
                requiresShift = true;
            } else if (path.contains(CHOICE_MARKER)) {
                choices.computeIfAbsent(path, p -> new StringBuilder()).append(segment.text());
            } else if (path.contains(BODY_MARKER)) {
                // neue Zeile -> Leerzeichen, damit Wörter an Zeilenenden nicht zusammenkleben
                if (lastBodyFont != null && !lastBodyFont.equals(path)) body.append(' ');
                body.append(segment.text());
                lastBodyFont = path;
            }
        }

        if (!found) return null;

        List<String> cleanedChoices = new ArrayList<>();
        for (StringBuilder choice : choices.values()) {
            String text = clean(choice.toString());
            if (!text.isEmpty()) cleanedChoices.add(text);
        }
        return new DialogueSnapshot(clean(body.toString()), List.copyOf(cleanedChoices), requiresShift);
    }

    /** Erkennt Dialogzeilen im älteren Chat-Format; liefert {@code {Name, Text}} oder {@code null}. */
    public static String[] parseChatLine(String line) {
        Matcher matcher = CHAT_DIALOGUE.matcher(clean(line));
        if (!matcher.matches()) return null;
        return new String[] {matcher.group(3).trim(), matcher.group(4).trim()};
    }

    /** Entfernt Abstands- und Symbolzeichen von Wynncraft und fasst Leerraum zusammen. */
    public static String clean(String text) {
        StringBuilder out = new StringBuilder(text.length());
        char last = ' ';
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == POSITION_MARKER) {
                i++; // zugehöriges Zeichen überspringen
                c = ' ';
            } else if (Character.isSurrogate(c) || (c >= '' && c <= '') || Character.isISOControl(c)) {
                // Symbole aus privaten Unicode-Bereichen (Icons, Rahmen) und Steuerzeichen
                c = ' ';
            } else if (Character.isWhitespace(c)) {
                c = ' ';
            }
            if (c == ' ' && last == ' ') continue;
            out.append(c);
            last = c;
        }
        return out.toString().trim();
    }
}
