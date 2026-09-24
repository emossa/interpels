CREATE TABLE "avviso" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "avviso_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"destinatario_id" integer NOT NULL,
	"giorno" date NOT NULL,
	"inviato_il" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stato_fonte" (
	"fonte" text PRIMARY KEY NOT NULL,
	"ultimo_successo" timestamp with time zone,
	"ultimo_errore" timestamp with time zone,
	"messaggio" text,
	"problema" text,
	"problema_dal" timestamp with time zone,
	"ultimo_avviso_il" date,
	"ripresa_il" timestamp with time zone,
	CONSTRAINT "stato_fonte_problema_valido" CHECK ("stato_fonte"."problema" in ('errore', 'silenzio', 'formato')),
	CONSTRAINT "stato_fonte_problema_dal_coerente" CHECK (("stato_fonte"."problema" is null) = ("stato_fonte"."problema_dal" is null))
);
--> statement-breakpoint
ALTER TABLE "avviso" ADD CONSTRAINT "avviso_destinatario_id_destinatario_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."destinatario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "avviso_destinatario_giorno" ON "avviso" USING btree ("destinatario_id","giorno");