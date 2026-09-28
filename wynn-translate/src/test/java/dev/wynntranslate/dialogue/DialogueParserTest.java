package dev.wynntranslate.dialogue;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

class DialogueParserTest {
    private static final String SPACE = "󏿼"; // Wynncraft-Abstandszeichen

    @Test
    void noDialogueFontsMeansNoDialogue() {
        assertNull(DialogueParser.parseActionBar(List.of(
                new TextSegment("", "❤ 1200/1200"),
                new TextSegment("hud/coordinates", "123 64 -50"))));
    }

    @Test
    void joinsBodyLinesAndDetectsShift() {
        DialogueSnapshot snapshot = DialogueParser.parseActionBar(List.of(
                new TextSegment("", "❤ 1200/1200 "),
                new TextSegment("hud/dialogue/background", ""),
                new TextSegment("hud/dialogue/text/body_0", "Hello" + SPACE + "traveler!"),
                new TextSegment("hud/dialogue/text/body_1", "The corrupted are" + SPACE + "near."),
                new TextSegment("hud/dialogue/effect/fade_2", "ignored"),
                new TextSegment("hud/dialogue/text/control", "")));

        assertEquals("Hello traveler! The corrupted are near.", snapshot.body());
        assertTrue(snapshot.requiresShift());
        assertTrue(snapshot.choices().isEmpty());
    }

    @Test
    void collectsChoicesSeparately() {
        DialogueSnapshot snapshot = DialogueParser.parseActionBar(List.of(
                new TextSegment("hud/dialogue/text/body_0", "Will you help us?"),
                new TextSegment("hud/dialogue/text/choice_0", "Yes, of course."),
                new TextSegment("hud/dialogue/text/choice_1", "No,"),
                new TextSegment("hud/dialogue/text/choice_1", " not now.")));

        assertEquals("Will you help us?", snapshot.body());
        assertEquals(List.of("Yes, of course.", "No, not now."), snapshot.choices());
        assertFalse(snapshot.requiresShift());
    }

    @Test
    void parsesLegacyChatDialogue() {
        assertArrayEquals(new String[] {"Guard Captain", "Stay back, the gate is closed!"},
                DialogueParser.parseChatLine("[2/5] Guard Captain: Stay back, the gate is closed!"));
        assertNull(DialogueParser.parseChatLine("[Party] Steve: hi"));
        assertNull(DialogueParser.parseChatLine("Just a normal message"));
    }

    @Test
    void cleanRemovesPrivateUseGlyphsAndCollapsesSpaces() {
        assertEquals("A B", DialogueParser.clean("  A" + SPACE + SPACE + "  B\n"));
    }
}
