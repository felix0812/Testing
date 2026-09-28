package dev.wynntranslate.dialogue;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class DialogueTrackerTest {
    private static DialogueSnapshot snap(String body, boolean shift, String... choices) {
        return new DialogueSnapshot(body, List.of(choices), shift);
    }

    @Test
    void finishesOnceWhenShiftAppears() {
        List<String> finished = new ArrayList<>();
        DialogueTracker tracker = new DialogueTracker(s -> finished.add(s.body()));

        tracker.update(snap("Hel", false));
        tracker.update(snap("Hello there", false));
        tracker.update(snap("Hello there", true));
        tracker.update(snap("Hello there", true));

        assertEquals(List.of("Hello there"), finished);
    }

    @Test
    void finishesAfterTextIsStableWithoutShift() {
        List<String> finished = new ArrayList<>();
        DialogueTracker tracker = new DialogueTracker(s -> finished.add(s.body()));

        tracker.update(snap("Auto dialogue", false));
        for (int i = 0; i < 30; i++) tracker.tick();

        assertEquals(List.of("Auto dialogue"), finished);
    }

    @Test
    void newTextStartsNewDialogueAndEmptyClears() {
        List<String> finished = new ArrayList<>();
        DialogueTracker tracker = new DialogueTracker(s -> finished.add(s.body()));

        tracker.update(snap("First line", true));
        tracker.update(snap("Second line", true));
        tracker.update(null);

        assertEquals(List.of("First line", "Second line"), finished);
        assertNull(tracker.current());
    }

    @Test
    void lateChoicesTriggerAgain() {
        List<Integer> choiceCounts = new ArrayList<>();
        DialogueTracker tracker = new DialogueTracker(s -> choiceCounts.add(s.choices().size()));

        tracker.update(snap("Help us?", true));
        tracker.update(snap("Help us?", true, "Yes", "No"));

        assertEquals(List.of(0, 2), choiceCounts);
    }
}
