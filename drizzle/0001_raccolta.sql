CREATE TABLE "interpello" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "interpello_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"tipo" text NOT NULL,
	"personale" text NOT NULL,
	"classi" text[] DEFAULT '{}'::text[] NOT NULL,
	"scuola" text,
	"codice_meccanografico" text,
	"comune" text,
	"provincia" text,
	"provincia_da" text,
	"protocollo" text,
	"data_protocollo" text,
	"protocollo_riferito" text,
	"ore" integer,
	"fino_al" text,
	"creato_il" timestamp with time zone DEFAULT now() NOT NULL,
	"aggiornato_il" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interpello_tipo_valido" CHECK ("interpello"."tipo" in ('interpello', 'annullamento', 'rettifica', 'riapertura', 'esito')),
	CONSTRAINT "interpello_personale_valido" CHECK ("interpello"."personale" in ('docente', 'ata-dsga', 'altro')),
	CONSTRAINT "interpello_provincia_da_coerente" CHECK (("interpello"."provincia" is null) = ("interpello"."provincia_da" is null))
);
--> statement-breakpoint
CREATE TABLE "pubblicazione" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pubblicazione_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"fonte" text NOT NULL,
	"chiave" text NOT NULL,
	"url" text NOT NULL,
	"intestazione" text NOT NULL,
	"pubblicata_il" timestamp with time zone NOT NULL,
	"documenti" jsonb NOT NULL,
	"letta_il" timestamp with time zone DEFAULT now() NOT NULL,
	"aggiornata_il" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pubblicazione_interpello" (
	"pubblicazione_id" integer NOT NULL,
	"interpello_id" integer NOT NULL,
	CONSTRAINT "pubblicazione_interpello_pubblicazione_id_interpello_id_pk" PRIMARY KEY("pubblicazione_id","interpello_id")
);
--> statement-breakpoint
ALTER TABLE "pubblicazione_interpello" ADD CONSTRAINT "pubblicazione_interpello_pubblicazione_id_pubblicazione_id_fk" FOREIGN KEY ("pubblicazione_id") REFERENCES "public"."pubblicazione"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pubblicazione_interpello" ADD CONSTRAINT "pubblicazione_interpello_interpello_id_interpello_id_fk" FOREIGN KEY ("interpello_id") REFERENCES "public"."interpello"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pubblicazione_fonte_chiave" ON "pubblicazione" USING btree ("fonte","chiave");