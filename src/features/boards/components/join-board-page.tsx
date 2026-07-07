import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/shared/components/ui/input-otp";
import { useJoinBoard } from "../hooks/use-join-board";
import { classifyJoinError } from "../lib/classify-join-error";
import {
  BACK_LABEL,
  JOIN_BOARD_CTA,
  JOIN_ERROR_INVALID_CODE,
  JOIN_PAGE_HEADING,
  JOIN_PAGE_HINT,
  TRANSPORT_ERROR,
} from "../lib/copy";

const JOIN_CODE_LENGTH = 8;
const JOIN_CODE_HALF = JOIN_CODE_LENGTH / 2;
// Share codes are 8 unambiguous upper-case/digit characters (see
// gen_join_code() in supabase/migrations/20260706120000_init.sql).
const JOIN_CODE_PATTERN = "^[A-Z2-9]+$";
const FIRST_GROUP_POSITIONS = Array.from(
  { length: JOIN_CODE_HALF },
  (_, i) => i
);
const SECOND_GROUP_POSITIONS = Array.from(
  { length: JOIN_CODE_HALF },
  (_, i) => i + JOIN_CODE_HALF
);

export function JoinBoardPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const joinBoard = useJoinBoard();

  async function submit(value: string): Promise<void> {
    setError(null);
    try {
      const board = await joinBoard.mutateAsync({ code: value });
      await navigate({
        params: { boardId: board.id },
        to: "/boards/$boardId",
      });
    } catch (submitError) {
      setCode("");
      const kind = classifyJoinError(submitError);
      setError(
        kind === "invalid-code" ? JOIN_ERROR_INVALID_CODE : TRANSPORT_ERROR
      );
    }
  }

  function onCodeChange(value: string): void {
    const next = value.toUpperCase();
    setCode(next);
    if (next.length === JOIN_CODE_LENGTH && !joinBoard.isPending) {
      submit(next);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        aria-label={BACK_LABEL}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        to="/"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {BACK_LABEL}
      </Link>

      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl tracking-tight">
            {JOIN_PAGE_HEADING}
          </CardTitle>
          <CardDescription>{JOIN_PAGE_HINT}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex justify-center">
            <InputOTP
              aria-label={JOIN_PAGE_HEADING}
              autoCapitalize="characters"
              disabled={joinBoard.isPending}
              inputMode="text"
              maxLength={JOIN_CODE_LENGTH}
              onChange={onCodeChange}
              pattern={JOIN_CODE_PATTERN}
              value={code}
            >
              <InputOTPGroup>
                {FIRST_GROUP_POSITIONS.map((position) => (
                  <InputOTPSlot index={position} key={position} />
                ))}
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                {SECOND_GROUP_POSITIONS.map((position) => (
                  <InputOTPSlot index={position} key={position} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error ? (
            <p className="text-center text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            disabled={joinBoard.isPending || code.length !== JOIN_CODE_LENGTH}
            onClick={() => submit(code)}
            type="button"
          >
            {JOIN_BOARD_CTA}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
