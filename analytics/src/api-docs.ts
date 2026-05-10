import { createApiReference } from "@scalar/api-reference";

createApiReference(document.getElementById("app")!, {
  spec: { url: "/openapi.json" },
  theme: "default",
  layout: "modern",
});
