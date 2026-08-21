"use client";

import { use } from "react";
import MembersManager from "@/components/asso/MembersManager";

export default function AssoMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MembersManager associationId={id} />;
}
