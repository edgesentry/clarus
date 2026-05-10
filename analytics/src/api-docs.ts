import { createApiReference } from "@scalar/api-reference";

const instance = createApiReference({
  url: "/openapi.json",
  theme: "default",
  layout: "modern",
});

instance.app.mount("#app");
