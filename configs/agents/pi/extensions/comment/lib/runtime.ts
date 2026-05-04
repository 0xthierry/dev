import { editWithExternalEditor } from "./external-editor";

export interface CommentRuntime {
  editText(initialText: string): Promise<string>;
}

export function createCommentRuntime(): CommentRuntime {
  return {
    editText: async (initialText) => editWithExternalEditor(initialText),
  };
}
