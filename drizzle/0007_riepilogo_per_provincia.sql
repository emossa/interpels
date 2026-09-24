DROP INDEX "riepilogo_destinatario_giorno";--> statement-breakpoint
ALTER TABLE "destinatario" ADD COLUMN "separa_province" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "riepilogo" ADD COLUMN "provincia" text;--> statement-breakpoint
ALTER TABLE "riepilogo" ADD CONSTRAINT "riepilogo_destinatario_giorno_provincia" UNIQUE NULLS NOT DISTINCT("destinatario_id","giorno","provincia");