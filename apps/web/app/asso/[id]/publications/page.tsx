"use client";

import { use } from "react";
import PostsManager from "@/components/asso/PostsManager";

export default function AssoPostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PostsManager associationId={id} />;
}
