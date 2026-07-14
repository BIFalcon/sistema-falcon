import { useMemo } from "react";
import type { OperaReservation, PrefeituraNota } from "@/lib/nfConferenceParser";

export type NfMatchStatus = "conciliado" | "divergencia" | "sem_nota" | "sem_reserva_opera";

export interface NfMatchDetail {
  status: NfMatchStatus;
  reservation: OperaReservation | null;
  notas: PrefeituraNota[];
  nameOk: boolean | null;
  dateOk: boolean | null;
  valueOk: boolean | null;
  motivos: string[];
}

export interface NfConferenceResult {
  conciliados: NfMatchDetail[];
  divergencias: NfMatchDetail[];
  semNota: NfMatchDetail[];
  semReservaOpera: NfMatchDetail[];
  semConfirmacaoIdentificada: PrefeituraNota[];
}

const VALUE_TOLERANCE = 1;

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function namesMatch(extracted: string | null, operaName: string): boolean | null {
  if (!extracted) return null;
  const parts = normalize(extracted).split(/\s+/).filter((p) => p.length > 2);
  if (parts.length === 0) return null;
  const opera = normalize(operaName);
  const matches = parts.filter((p) => opera.includes(p));
  return matches.length >= Math.max(1, Math.ceil(parts.length / 2));
}

function dateMatch(extracted: string | null, operaDate: string): boolean | null {
  if (!extracted || !operaDate) return null;
  return extracted === operaDate;
}

function valueMatchesAnyLine(valor: number, reservation: OperaReservation): boolean {
  return reservation.lines.some(
    (l) =>
      Math.abs(valor - l.netAmount) < VALUE_TOLERANCE ||
      Math.abs(valor - l.paymentAmount) < VALUE_TOLERANCE,
  );
}

export function useNfConference(
  reservations: OperaReservation[],
  notas: PrefeituraNota[],
): NfConferenceResult | null {
  return useMemo(() => {
    if (!reservations.length && !notas.length) return null;

    const notasComConfirmacao = notas.filter((n) => n.confirmationNumber);
    const semConfirmacaoIdentificada = notas.filter((n) => !n.confirmationNumber);

    const notasByConf = new Map<string, PrefeituraNota[]>();
    for (const n of notasComConfirmacao) {
      const arr = notasByConf.get(n.confirmationNumber!) ?? [];
      arr.push(n);
      notasByConf.set(n.confirmationNumber!, arr);
    }

    const conciliados: NfMatchDetail[] = [];
    const divergencias: NfMatchDetail[] = [];
    const semNota: NfMatchDetail[] = [];

    for (const reservation of reservations) {
      const notasDaReserva = notasByConf.get(reservation.confirmationNumber) ?? [];

      if (notasDaReserva.length === 0) {
        semNota.push({
          status: "sem_nota",
          reservation,
          notas: [],
          nameOk: null,
          dateOk: null,
          valueOk: null,
          motivos: ["Nenhuma nota emitida encontrada para esta confirmação"],
        });
        continue;
      }

      const motivos: string[] = [];
      let nameOk: boolean | null = true;
      let dateOk: boolean | null = true;
      let valueOk = true;

      for (const nota of notasDaReserva) {
        const n = namesMatch(nota.guestNameExtracted, reservation.guestName);
        if (n === false) {
          nameOk = false;
          motivos.push(
            `Nome divergente na nota ${nota.numeroNfse}: "${nota.guestNameExtracted}" ≠ "${reservation.guestName}"`,
          );
        }

        const d = dateMatch(nota.checkIn, reservation.arrival);
        if (d === false) {
          dateOk = false;
          motivos.push(
            `Check-in divergente na nota ${nota.numeroNfse}: ${nota.checkIn} ≠ ${reservation.arrival}`,
          );
        }

        const v = valueMatchesAnyLine(nota.valorServico, reservation);
        if (!v) {
          valueOk = false;
          motivos.push(
            `Valor da nota ${nota.numeroNfse} (R$ ${nota.valorServico.toFixed(2)}) não bate com nenhuma linha do Opera`,
          );
        }
      }

      const detail: NfMatchDetail = {
        status: "conciliado",
        reservation,
        notas: notasDaReserva,
        nameOk,
        dateOk,
        valueOk,
        motivos,
      };

      if (motivos.length === 0) {
        conciliados.push(detail);
      } else {
        detail.status = "divergencia";
        divergencias.push(detail);
      }

      notasByConf.delete(reservation.confirmationNumber);
    }

    const semReservaOpera: NfMatchDetail[] = [...notasByConf.entries()].map(([conf, ns]) => ({
      status: "sem_reserva_opera",
      reservation: null,
      notas: ns,
      nameOk: null,
      dateOk: null,
      valueOk: null,
      motivos: [`Confirmação ${conf} não encontrada no arquivo do Opera enviado`],
    }));

    return { conciliados, divergencias, semNota, semReservaOpera, semConfirmacaoIdentificada };
  }, [reservations, notas]);
}