// @vitest-environment jsdom
/** user-name-row.test.tsx — the device-wide name field: what it keeps while focused, and what blur shows. */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, expect, it } from "vitest";
import { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { UserNameRow } from "./user-name-row";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
});

it("keeps what is typed while focused, and shows the stored name after blur", () => {
  const store = createUserNameSettings({ storage: { load: () => null, save: () => {} } });
  const { getByRole } = render(<UserNameRow store={store} />);
  const input = getByRole("textbox", { name: "Your name" }) as HTMLInputElement;

  input.focus();
  fireEvent.input(input, { target: { value: "Ren " } });
  expect(store.current().name).toBe("Ren");

  act(() => store.setName("Aki"));
  expect(input.value).toBe("Ren ");

  fireEvent.blur(input);
  expect(input.value).toBe("Aki");
});
