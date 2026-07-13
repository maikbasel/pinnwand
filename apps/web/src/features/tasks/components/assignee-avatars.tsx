import { useBoardMembers } from "@/features/members";
import { Avatar, AvatarFallback } from "@/shared/components/ui/avatar";

const MAX_SHOWN = 3;

function initials(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : "?";
}

export function AssigneeAvatars({
  boardId,
  assigneeIds,
}: {
  boardId: string;
  assigneeIds: string[];
}) {
  const { members } = useBoardMembers(boardId);
  if (assigneeIds.length === 0) {
    return null;
  }
  const shown = assigneeIds.slice(0, MAX_SHOWN);
  const overflow = assigneeIds.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((id) => {
        const name = members.find((m) => m.userId === id)?.displayName ?? "";
        return (
          <Avatar className="size-6 ring-2 ring-card" key={id}>
            <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
        );
      })}
      {overflow > 0 ? (
        <span className="ml-3 text-muted-foreground text-xs">+{overflow}</span>
      ) : null}
    </div>
  );
}
