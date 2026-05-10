import { createApiReference } from "@scalar/api-reference";

createApiReference(document.getElementById("app")!, {
  url: "/openapi.json",
  theme: "default",
  layout: "modern",
});
