-- Add the 'mention' value to the NotificationType enum (@mentions feature).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'mention';
