import { Search, Users, X } from "lucide-react";
import { useState } from "react";
import { useBoardMembers } from "@/features/members";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";
import { Badge } from "@/shared/components/ui/badge";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  ASSIGNEE_REMOVE_LABEL,
  ASSIGNEE_SEARCH_PLACEHOLDER,
  TASK_ASSIGNEES_ALL_ASSIGNED,
  TASK_ASSIGNEES_EMPTY,
  TASK_ASSIGNEES_LABEL,
  TASK_ASSIGNEES_LOAD_ERROR,
  TASK_ASSIGNEES_NO_MATCH,
} from "../lib/copy";

function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "?";
}

/**
 * Trello/Jira-style assignee picker: assigned members show as removable avatar
 * chips, and a search field filters the board's remaining members inline (each
 * a tappable avatar row). Results render inline rather than in a floating
 * combobox popup on purpose — a portaled popup inside the mobile Vaul drawer
 * inherits the body-lock and fights the soft keyboard.
 */
export function AssigneePicker({
  boardId,
  value,
  onChange,
}: {
  boardId: string;
  value: string[];
  onChange: (userIds: string[]) => void;
}) {
  const { members, isPending, isError } = useBoardMembers(boardId);
  const [query, setQuery] = useState("");

  function add(userId: string): void {
    onChange([...value, userId]);
    setQuery("");
  }

  function remove(userId: string): void {
    onChange(value.filter((id) => id !== userId));
  }

  const selected = members.filter((member) => value.includes(member.userId));
  const normalizedQuery = query.trim().toLowerCase();
  const candidates = members.filter(
    (member) =>
      !value.includes(member.userId) &&
      member.displayName.toLowerCase().includes(normalizedQuery)
  );
  const noCandidatesMessage =
    normalizedQuery === ""
      ? TASK_ASSIGNEES_ALL_ASSIGNED
      : TASK_ASSIGNEES_NO_MATCH;
  const ready = !(isPending || isError);

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 font-medium text-sm">
        <Users aria-hidden="true" className="size-4 text-muted-foreground" />
        {TASK_ASSIGNEES_LABEL}
      </span>

      {isPending ? <Skeleton className="h-9 w-full" /> : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertDescription>{TASK_ASSIGNEES_LOAD_ERROR}</AlertDescription>
        </Alert>
      ) : null}

      {ready && members.length === 0 ? (
        <p className="text-muted-foreground text-sm">{TASK_ASSIGNEES_EMPTY}</p>
      ) : null}

      {ready && members.length > 0 ? (
        <>
          {selected.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {selected.map((member) => (
                <li key={member.userId}>
                  <Badge className="gap-1.5 py-1 pr-1 pl-1" variant="secondary">
                    <Avatar aria-hidden="true" className="size-5">
                      <AvatarFallback className="bg-primary text-[9px] text-primary-foreground">
                        {initials(member.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    {member.displayName}
                    <button
                      aria-label={`${ASSIGNEE_REMOVE_LABEL}: ${member.displayName}`}
                      className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      onClick={() => remove(member.userId)}
                      type="button"
                    >
                      <X className="size-3.5" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ASSIGNEE_SEARCH_PLACEHOLDER}
              value={query}
            />
          </div>

          {candidates.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {candidates.map((member) => (
                <li key={member.userId}>
                  <button
                    className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted"
                    onClick={() => add(member.userId)}
                    type="button"
                  >
                    <Avatar aria-hidden="true" className="size-7">
                      <AvatarFallback className="bg-secondary text-[10px] text-secondary-foreground">
                        {initials(member.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    {member.displayName}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              {noCandidatesMessage}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
