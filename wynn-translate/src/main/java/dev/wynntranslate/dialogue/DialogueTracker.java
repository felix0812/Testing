package dev.wynntranslate.dialogue;

import java.util.function.Consumer;

/**
 * Verfolgt den aktuellen Dialog über mehrere Aktionsleisten-Updates hinweg. Der Text wird
 * buchstabenweise "getippt"; übersetzt wird erst, wenn er fertig ist (Shift-Hinweis) oder
 * eine Weile unverändert bleibt.
 */
public class DialogueTracker {
    /** Ticks ohne Änderung, nach denen ein Text auch ohne Shift-Hinweis als fertig gilt. */
    private static final int STABLE_TICKS = 25;
    /** Ticks ohne Aktionsleisten-Update, nach denen der Dialog als beendet gilt. */
    private static final int TIMEOUT_TICKS = 100;

    private final Consumer<DialogueSnapshot> onFinished;
    private DialogueSnapshot current;
    private boolean finished;
    private int stableTicks;
    private int ticksSinceUpdate;

    public DialogueTracker(Consumer<DialogueSnapshot> onFinished) {
        this.onFinished = onFinished;
    }

    /** Neues Aktionsleisten-Update; {@code snapshot} ist {@code null}, wenn kein Dialog zu sehen ist. */
    public void update(DialogueSnapshot snapshot) {
        ticksSinceUpdate = 0;
        if (snapshot == null) {
            clear();
            return;
        }

        boolean isNew = current == null || !snapshot.body().startsWith(current.body());
        if (isNew) {
            finished = false;
        }
        if (current == null || !snapshot.body().equals(current.body()) || !snapshot.choices().equals(current.choices())) {
            stableTicks = 0;
        }
        boolean newChoices = finished && !isNew && !snapshot.choices().isEmpty()
                && !snapshot.choices().equals(current.choices());
        current = snapshot;

        if (newChoices) {
            // Antwortmöglichkeiten sind erst nach dem Text erschienen -> nachträglich übersetzen
            onFinished.accept(current);
        } else if (snapshot.requiresShift() && !snapshot.body().isEmpty()) {
            finish();
        }
    }

    public void tick() {
        if (current == null) return;
        if (++ticksSinceUpdate > TIMEOUT_TICKS) {
            clear();
            return;
        }
        if (!finished && ++stableTicks >= STABLE_TICKS && !current.body().isEmpty()) finish();
    }

    public void clear() {
        current = null;
        finished = false;
        stableTicks = 0;
    }

    private void finish() {
        if (finished) return;
        finished = true;
        onFinished.accept(current);
    }

    public DialogueSnapshot current() {
        return current;
    }

    public boolean isFinished() {
        return finished;
    }
}
