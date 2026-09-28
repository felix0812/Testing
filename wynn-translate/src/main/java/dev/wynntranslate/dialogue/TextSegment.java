package dev.wynntranslate.dialogue;

/** Ein Textstück aus einer Server-Nachricht zusammen mit dem Pfad der Schriftart, in der es gezeichnet wird. */
public record TextSegment(String fontPath, String text) {}
