import { Type } from "typebox";

export const COMPUTER_USE_CODE_PARAMETERS = Type.Object(
  {
    code: Type.String({
      description:
        "JavaScript body to execute. Use await sky.<method>(args), emit(value), emitImage(screenshot), and store for state shared across calls.",
    }),
  },
  { additionalProperties: false },
);

export const COMPUTER_USE_CODE_DESCRIPTION = `Run JavaScript that composes OpenAI's official signed macOS Computer Use methods in one call. No nested model is used.

Available globals:
- sky.list_apps() -> text app inventory
- sky.get_app_state({ app, disableDiff? }) -> { app, text, screenshot }
- sky.click({ app, element_index?, x?, y?, mouse_button?, click_count? })
- sky.perform_secondary_action({ app, element_index, action })
- sky.set_value({ app, element_index, value })
- sky.select_text({ app, element_index, text, prefix?, suffix?, selection? })
- sky.scroll({ app, element_index, direction, pages? })
- sky.drag({ app, from_x, from_y, to_x, to_y })
- sky.press_key({ app, key })
- sky.type_text({ app, text })
- emit(value) returns text or JSON to Pi
- emitImage(state.screenshot) returns a screenshot to Pi
- store is a persistent JSON object shared across calls

get_app_state may return an accessibility-tree diff after the first inspection. Pass disableDiff: true when you need a fresh full tree.

Example:
const state = await sky.get_app_state({ app: "TextEdit" });
emit(state.text);

Batch known actions sequentially, then inspect again before deciding the next step.`;
