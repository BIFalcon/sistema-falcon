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
  totals: {
    reservationsTotal: number;
    notasTotal: number;
    conciliadosTotal: number;
    divergenciasTotal: number;
    semNotaTotal: number;
    semReservaTotal: number;
  };
}

const VALUE_TOLERANCE = 1;

const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const normKey = (s: string | null | undefined) => String(s ?? "").trim().replace(/^0+/, "");

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

    // Indexa notas por RPS (chave primária) e por confirmação (fallback).
    const notasByRps = new Map<string, PrefeituraNota[]>();
    const notasByConf = new Map<string, PrefeituraNota[]>();
    const notasSemChave: PrefeituraNota[] = [];
    for (const n of notas) {
      const rpsKey = normKey(n.rps);
      const confKey = normKey(n.confirmationNumber);
      if (rpsKey) {
        const arr = notasByRps.get(rpsKey) ?? [];
        arr.push(n);
        notasByRps.set(rpsKey, arr);
      } else if (confKey) {
        const arr = notasByConf.get(confKey) ?? [];
        arr.push(n);
        notasByConf.set(confKey, arr);
      } else {
        notasSemChave.push(n);
      }
    }
    const usedNota = new Set<string>();

    const conciliados: NfMatchDetail[] = [];
    const divergencias: NfMatchDetail[] = [];
    const semNota: NfMatchDetail[] = [];

    for (const reservation of reservations) {
      // 1) Match por RPS = Fiscal Bill Number das linhas do Opera.
      const notasDaReserva: PrefeituraNota[] = [];
      const seen = new Set<string>();
      for (const line of reservation.lines) {
        const k = normKey(line.fiscalBillNumber);
        if (!k) continue;
        const found = notasByRps.get(k);
        if (!found) continue;
        for (const n of found) {
          if (seen.has(n.numeroNfse)) continue;
          seen.add(n.numeroNfse);
          usedNota.add(`rps:${k}:${n.numeroNfse}`);
          notasDaReserva.push(n);
        }
      }
      // 2) Fallback por confirmação (quando a Prefeitura tem descrição).
      const confKey = normKey(reservation.confirmationNumber);
      const byConf = confKey ? notasByConf.get(confKey) ?? [] : [];
      for (const n of byConf) {
        if (seen.has(n.numeroNfse)) continue;
        seen.add(n.numeroNfse);
        usedNota.add(`conf:${confKey}:${n.numeroNfse}`);
        notasDaReserva.push(n);
      }
      if (confKey) notasByConf.delete(confKey);

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
    }

    // Notas remanescentes: sobrou RPS não encontrado no Opera OU confirmação sobrando.
    const semReservaOpera: NfMatchDetail[] = [];
    for (const [rps, ns] of notasByRps.entries()) {
      const remaining = ns.filter(
        (n) => !usedNota.has(`rps:${rps}:${n.numeroNfse}`),
      );
      if (remaining.length === 0) continue;
      semReservaOpera.push({
        status: "sem_reserva_opera",
        reservation: null,
        notas: remaining,
        nameOk: null,
        dateOk: null,
        valueOk: null,
        motivos: [`RPS ${rps} não encontrado como Fiscal Bill Number no Opera`],
      });
    }
    for (const [conf, ns] of notasByConf.entries()) {
      semReservaOpera.push({
        status: "sem_reserva_opera",
        reservation: null,
        notas: ns,
        nameOk: null,
        dateOk: null,
        valueOk: null,
        motivos: [`Confirmação ${conf} não encontrada no Opera`],
      });
    }
    const semConfirmacaoIdentificada = notasSemChave;

    const sumRes = (arr: NfMatchDetail[]) =>
      arr.reduce((s, d) => s + (d.reservation?.totalNet ?? 0), 0);
    const sumNotas = (arr: NfMatchDetail[]) =>
      arr.reduce((s, d) => s + d.notas.reduce((ss, n) => ss + n.valorServico, 0), 0);

    return {
      conciliados,
      divergencias,
      semNota,
      semReservaOpera,
      semConfirmacaoIdentificada,
      totals: {
        reservationsTotal: reservations.reduce((s, r) => s + r.totalNet, 0),
        notasTotal: notas.reduce((s, n) => s + n.valorServico, 0),
        conciliadosTotal: sumNotas(conciliados),
        divergenciasTotal: sumNotas(divergencias) || sumRes(divergencias),
        semNotaTotal: sumRes(semNota),
        semReservaTotal: sumNotas(semReservaOpera),
      },
    };
  }, [reservations, notas]);
}