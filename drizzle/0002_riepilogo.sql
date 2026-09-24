CREATE TABLE "invio" (
	"destinatario_id" integer NOT NULL,
	"interpello_id" integer NOT NULL,
	"riepilogo_id" integer NOT NULL,
	CONSTRAINT "invio_destinatario_id_interpello_id_pk" PRIMARY KEY("destinatario_id","interpello_id")
);
--> statement-breakpoint
CREATE TABLE "riepilogo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "riepilogo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"destinatario_id" integer NOT NULL,
	"giorno" date NOT NULL,
	"inviato_il" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invio" ADD CONSTRAINT "invio_destinatario_id_destinatario_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."destinatario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invio" ADD CONSTRAINT "invio_interpello_id_interpello_id_fk" FOREIGN KEY ("interpello_id") REFERENCES "public"."interpello"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invio" ADD CONSTRAINT "invio_riepilogo_id_riepilogo_id_fk" FOREIGN KEY ("riepilogo_id") REFERENCES "public"."riepilogo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riepilogo" ADD CONSTRAINT "riepilogo_destinatario_id_destinatario_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."destinatario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "riepilogo_destinatario_giorno" ON "riepilogo" USING btree ("destinatario_id","giorno");