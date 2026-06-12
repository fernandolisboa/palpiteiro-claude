"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        {/* NextError requires statusCode; App Router doesn't expose status codes, so we pass 0 */}
        <NextError statusCode={0} />
        <button onClick={() => reset()}>Tentar novamente</button>
      </body>
    </html>
  );
}
