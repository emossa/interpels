CREATE TABLE "destinatario" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "destinatario_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"attivo" boolean DEFAULT true NOT NULL,
	"creato_il" timestamp with time zone DEFAULT now() NOT NULL,
	"disattivato_il" timestamp with time zone,
	CONSTRAINT "destinatario_disattivazione_coerente" CHECK ("destinatario"."attivo" = ("destinatario"."disattivato_il" is null))
);
--> statement-breakpoint
CREATE TABLE "preferenza" (
	"destinatario_id" integer NOT NULL,
	"genere" text NOT NULL,
	"valore" text NOT NULL,
	CONSTRAINT "preferenza_destinatario_id_genere_valore_pk" PRIMARY KEY("destinatario_id","genere","valore"),
	CONSTRAINT "preferenza_genere_valido" CHECK ("preferenza"."genere" in ('classe', 'gruppo', 'provincia'))
);
--> statement-breakpoint
ALTER TABLE "preferenza" ADD CONSTRAINT "preferenza_destinatario_id_destinatario_id_fk" FOREIGN KEY ("destinatario_id") REFERENCES "public"."destinatario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "destinatario_email_unica" ON "destinatario" USING btree (lower("email"));