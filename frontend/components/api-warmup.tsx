"use client";

import { useEffect } from "react";

import { warmUpApi } from "@/lib/api";

/** Starts the API container in the background as soon as the page loads. Renders nothing. */
export function ApiWarmup() {
  useEffect(() => {
    warmUpApi();
  }, []);

  return null;
}
