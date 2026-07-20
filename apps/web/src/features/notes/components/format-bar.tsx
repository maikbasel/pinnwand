import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useKeyboardInset } from "@/shared/hooks/use-keyboard-inset";
import { useIsMobile } from "@/shared/hooks/use-mobile";

type FormatAction = {
  label: string;
  icon: typeof Bold;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
};

const ACTIONS: FormatAction[] = [
  {
    label: "Absatz",
    icon: Pilcrow,
    isActive: (e) => e.isActive("paragraph"),
    run: (e) => e.chain().focus().setParagraph().run(),
  },
  {
    label: "Überschrift 1",
    icon: Heading1,
    isActive: (e) => e.isActive("heading", { level: 1 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    label: "Überschrift 2",
    icon: Heading2,
    isActive: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Überschrift 3",
    icon: Heading3,
    isActive: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Fett",
    icon: Bold,
    isActive: (e) => e.isActive("bold"),
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: "Kursiv",
    icon: Italic,
    isActive: (e) => e.isActive("italic"),
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: "Aufzählung",
    icon: List,
    isActive: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Nummerierte Liste",
    icon: ListOrdered,
    isActive: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Aufgabenliste",
    icon: ListChecks,
    isActive: (e) => e.isActive("taskList"),
    run: (e) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: "Zitat",
    icon: Quote,
    isActive: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: "Codeblock",
    icon: Code,
    isActive: (e) => e.isActive("codeBlock"),
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

const DESKTOP_CLASS =
  "sticky top-0 z-10 flex gap-1 overflow-x-auto border-b bg-background px-2 py-1";
// fixed + inset-x-0 docks the bar to the screen bottom (offset by the inline
// `bottom` inset below); z-20 keeps it above the editor content it now floats
// over.
const MOBILE_CLASS =
  "fixed inset-x-0 z-20 flex gap-1 overflow-x-auto border-t bg-background px-2 py-1";

/**
 * A docked bar rather than a selection-anchored bubble menu (sticky top on
 * desktop, above the keyboard on mobile; see the placement note below).
 *
 * A bubble menu is the wrong primitive on mobile: Tiptap issues 6571 and 1806
 * document the floating toolbar sitting mid-screen when the virtual keyboard
 * opens and iOS Safari dropping the selection on button tap. A docked bar never
 * needs selection-anchored positioning.
 *
 * It also covers the one gap input rules cannot express: no input rule removes
 * a heading, so "Absatz" is the only way back to a paragraph.
 *
 * On mobile (< 768px) the bar is `fixed` and tracks the on-screen keyboard via
 * `useKeyboardInset`, so it stays pinned just above the keyboard (iOS Notes /
 * Google Docs style) instead of the keyboard covering it. Desktop keeps the
 * original sticky-top placement.
 */
export function FormatBar({ editor }: { editor: Editor | null }) {
  const isMobile = useIsMobile();
  const keyboardInset = useKeyboardInset();

  if (!editor) {
    return null;
  }
  return (
    <div
      aria-label="Formatierung"
      className={isMobile ? MOBILE_CLASS : DESKTOP_CLASS}
      role="toolbar"
      style={isMobile ? { bottom: keyboardInset } : undefined}
    >
      {ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <Button
            aria-label={action.label}
            aria-pressed={action.isActive(editor)}
            key={action.label}
            // onClick applies the format (reliable through the Base UI button's
            // own press handling, unlike a raw onMouseDown action). onMouseDown
            // only preventDefaults, to keep the editor selection and the virtual
            // keyboard alive through the tap.
            onClick={() => action.run(editor)}
            onMouseDown={(event) => event.preventDefault()}
            size="icon"
            type="button"
            variant={action.isActive(editor) ? "secondary" : "ghost"}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </div>
  );
}
