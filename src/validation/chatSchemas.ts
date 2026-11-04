import { z } from 'zod';
import { failure, success, type Result } from '../utils/fp';
import { ValidationError } from '../errors/sanctuaryError';

export const ChatMessageInputSchema = z.object({
  sessionCode: z.string().trim().min(1, 'Session code is required').max(32),
  senderId: z.string().trim().min(1, 'Sender ID is required').max(64),
  senderName: z.string().trim().min(1, 'Sender name is required').max(64),
  senderRole: z.string().trim().min(1, 'Sender role is required').max(32),
  message: z.string().trim().min(1, 'Message cannot be empty').max(500, 'Message cannot exceed 500 characters')
});

export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>;

export const ChatMessageRecordSchema = z.object({
  id: z.string().min(1),
  session: z.string().optional().nullable(),
  table: z.string().optional().nullable(),
  txt_session_code: z.string().min(1),
  txt_sender_id: z.string().min(1),
  txt_sender_name: z.string().min(1),
  txt_sender_role: z.string().min(1),
  txt_message: z.string().min(1),
  int_created_at: z.number().optional().default(0),
  created: z.string().optional(),
  updated: z.string().optional()
});

export type ChatMessageRecordData = z.infer<typeof ChatMessageRecordSchema>;

const describeIssues = (error: z.ZodError): string =>
  error.issues.map(issue => `${issue.path.join('.') || 'record'}: ${issue.message}`).join('; ');

export const parseChatMessageInput = (input: unknown): Result<ChatMessageInput, ValidationError> => {
  const result = ChatMessageInputSchema.safeParse(input);
  if (!result.success) {
    const errorDetail = describeIssues(result.error);
    return failure(new ValidationError('CHAT_VALIDATION_ERROR', `Chat message validation failed: ${errorDetail}`, { errorDetail }));
  }
  return success(result.data);
};

export const parseChatMessageRecord = (record: unknown): Result<ChatMessageRecordData, ValidationError> => {
  const result = ChatMessageRecordSchema.safeParse(record);
  if (!result.success) {
    const errorDetail = describeIssues(result.error);
    return failure(new ValidationError('CHAT_RECORD_PARSE_ERROR', `Chat message record parse error: ${errorDetail}`, { errorDetail }));
  }
  return success(result.data);
};
