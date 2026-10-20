import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsentChannel,
  ConsentEvidenceType,
  ConsentPurpose,
  ConsentSource,
  ConsentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContext, type TenantScope } from '../security/tenant-context.js';
import { UsageService } from '../usage/usage.service.js';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { assertReadableMessageText } from '../common/message-text-integrity.js';

type PatientStatusFilter = 'ACTIVE' | 'ARCHIVED' | 'ALL';
type PatientListQuery = {
  search?: string;
  unitId?: string;
  tagId?: string;
  includeUnassigned?: string;
  status?: string;
  page?: string;
  pageSize?: string;
};

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContext,
    private readonly usage: UsageService,
  ) {}

  async list(query: PatientListQuery = {}) {
    const scope = this.requireScope();
    const page = this.positiveInteger(query.page, 1, 1_000_000, 'Página');
    const pageSize = this.positiveInteger(query.pageSize, 25, 100, 'Tamanho da página');
    const search = this.optionalText(query.search, 120);
    const status = this.patientStatus(query.status);
    const tagId = query.tagId?.trim() ?? '';
    if (tagId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tagId)) {
      throw new BadRequestException('Etiqueta inválida.');
    }
    const allowedUnitIds = await this.allowedUnits(scope);
    const canIncludeUnassigned = query.unitId != null
      && query.includeUnassigned === 'true'
      && ['TENANT_ADMIN', 'UNIT_MANAGER', 'OPERATOR'].includes(scope.role);

    if (query.unitId && allowedUnitIds && !allowedUnitIds.includes(query.unitId)) {
      throw new ForbiddenException('Unidade fora do escopo do usuário.');
    }
    if (query.unitId) {
      const unit = await this.prisma.scoped.unit.findFirst({
        where: { id: query.unitId, active: true },
        select: { id: true },
      });
      if (!unit) throw new BadRequestException('Unidade inválida para este tenant.');
    }

    const clauses: Prisma.PatientWhereInput[] = [{ tenantId: scope.tenantId }];
    if (status === 'ACTIVE') clauses.push({ active: true, deletedAt: null });
    if (status === 'ARCHIVED') clauses.push({ OR: [{ active: false }, { deletedAt: { not: null } }] });
    if (tagId) clauses.push({ tags: { some: { tenantId: scope.tenantId, tagId } } });
    if (allowedUnitIds) clauses.push(canIncludeUnassigned
      ? { OR: [{ unitId: { in: allowedUnitIds } }, { unitId: null }] }
      : { unitId: { in: allowedUnitIds } });
    if (query.unitId) {
      clauses.push(canIncludeUnassigned ? { OR: [{ unitId: query.unitId }, { unitId: null }] } : { unitId: query.unitId });
    }
    if (search) {
      clauses.push({
        OR: [
          { fullName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
          { phoneNormalized: { contains: search.replace(/\D/g, '') || search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.PatientWhereInput = { AND: clauses };
    return this.prisma.unscoped.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.patient.count({ where }),
        tx.patient.findMany({
          where,
          include: {
            unit: { select: { id: true, name: true } },
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          },
          orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async get(id: string) {
    const scope = this.requireScope();
    const patient = await this.prisma.scoped.patient.findFirst({
      where: { id },
      include: { unit: { select: { id: true, name: true } } },
    });
    if (!patient) throw new NotFoundException('Paciente não encontrado.');
    const allowedUnitIds = await this.allowedUnits(scope);
    if (!patient.unitId && allowedUnitIds) {
      const appointmentInScope = await this.prisma.scoped.appointment.findFirst({
        where: { patientId: id, unitId: { in: allowedUnitIds } },
        select: { id: true },
      });
      if (!appointmentInScope) throw new NotFoundException('Paciente não encontrado no escopo do usuário.');
    } else {
      await this.assertPatientUnitAccess(scope, patient.unitId);
    }

    const [appointments, conversations, npsSurveys] = await Promise.all([
      this.prisma.scoped.appointment.findMany({
        where: {
          patientId: id,
          ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}),
        },
        include: {
          unit: { select: { id: true, name: true } },
          procedure: { select: { id: true, name: true } },
          resources: { include: { resource: { select: { id: true, name: true, type: true } } } },
        },
        orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
      this.prisma.scoped.conversation.findMany({
        where: {
          patientId: id,
          ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}),
        },
        select: {
          id: true,
          unitId: true,
          status: true,
          assignedToId: true,
          lastMessageAt: true,
          createdAt: true,
          unit: { select: { id: true, name: true } },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: 10,
      }),
      ['TENANT_ADMIN', 'UNIT_MANAGER'].includes(scope.role)
        ? this.prisma.scoped.npsSurvey.findMany({
            where: { patientId: id, ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}) },
            select: { id: true, unitId: true, status: true, score: true, scheduledAt: true, respondedAt: true, responseSource: true, followupTaskId: true, unit: { select: { name: true } } },
            orderBy: [{ scheduledAt: 'desc' }, { id: 'desc' }],
            take: 10,
          })
        : Promise.resolve([]),
    ]);

    const appointmentCreatorIds = [...new Set(appointments.flatMap((appointment) => appointment.createdById ? [appointment.createdById] : []))];
    const appointmentCreators = appointmentCreatorIds.length
      ? await this.prisma.unscoped.user.findMany({
          where: { id: { in: appointmentCreatorIds }, memberships: { some: { tenantId: scope.tenantId } } },
          select: { id: true, displayName: true },
        })
      : [];
    const appointmentCreatorNames = new Map(appointmentCreators.map((user) => [user.id, user.displayName]));

    const assignedIds = [...new Set(conversations.flatMap((item) => item.assignedToId ? [item.assignedToId] : []))];
    const assignedUsers = assignedIds.length
      ? await this.prisma.unscoped.user.findMany({
          where: { id: { in: assignedIds }, memberships: { some: { tenantId: scope.tenantId } } },
          select: { id: true, displayName: true },
        })
      : [];
    const userNames = new Map(assignedUsers.map((user) => [user.id, user.displayName]));

    return {
      ...patient,
      appointments: appointments.map((appointment) => ({
        ...appointment,
        createdByName: appointment.createdById ? appointmentCreatorNames.get(appointment.createdById) ?? null : null,
      })),
      npsSurveys,
      conversations: conversations.map((conversation) => ({
        ...conversation,
        assignedToName: conversation.assignedToId ? userNames.get(conversation.assignedToId) ?? null : null,
      })),
    };
  }

  async messages(id: string) {
    const scope = this.requireScope();
    const patient = await this.prisma.scoped.patient.findFirst({ where: { id }, select: { id: true, unitId: true } });
    if (!patient) throw new NotFoundException('Paciente não encontrado.');
    const allowedUnitIds = await this.allowedUnits(scope);
    if (!patient.unitId && allowedUnitIds) {
      const appointmentInScope = await this.prisma.scoped.appointment.findFirst({ where: { patientId: id, unitId: { in: allowedUnitIds } }, select: { id: true } });
      if (!appointmentInScope) throw new NotFoundException('Paciente não encontrado no escopo do usuário.');
    } else {
      await this.assertPatientUnitAccess(scope, patient.unitId);
    }
    return this.prisma.scoped.message.findMany({
      where: { conversation: { patientId: id, ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}) } },
      include: { conversation: { select: { id: true, unit: { select: { name: true } } } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
  }

  async listDocuments(id: string) {
    await this.get(id);
    return this.prisma.scoped.patientDocument.findMany({
      where: { patientId: id },
      select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true, uploadedBy: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async uploadDocument(id: string, file?: { buffer: Buffer; originalname: string; mimetype: string; size: number }) {
    const scope = this.requireScope();
    if (!file?.buffer?.length) throw new BadRequestException('Selecione um arquivo para enviar.');
    if (file.size > 10 * 1024 * 1024 || file.buffer.length > 10 * 1024 * 1024) throw new BadRequestException('O arquivo deve ter no máximo 10 MB.');
    await this.get(id);
    const mimeType = this.detectPatientDocumentType(file.buffer);
    if (!mimeType) throw new BadRequestException('Envie um documento PDF, JPG ou PNG válido.');
    const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : '.jpg';
    const cleanedName = Array.from(basename(file.originalname))
      .filter((character) => {
        const code = character.charCodeAt(0);
        return character !== '/' && character !== '\\' && code > 31 && code !== 127;
      })
      .join('').trim().slice(0, 180);
    const originalName = cleanedName || `documento${extension}`;
    const storageKey = `${randomUUID()}.bin`;
    const tenantDirectory = join(this.patientDocumentsRoot(), scope.tenantId);
    const storagePath = join(tenantDirectory, storageKey);
    await mkdir(tenantDirectory, { recursive: true, mode: 0o700 });
    await writeFile(storagePath, file.buffer, { flag: 'wx', mode: 0o600 });
    try {
      const document = await this.prisma.scoped.patientDocument.create({
        data: { tenantId: scope.tenantId, patientId: id, uploadedByUserId: scope.userId, originalName, mimeType, size: file.buffer.length, storageKey },
        select: { id: true, originalName: true, mimeType: true, size: true, createdAt: true },
      });
      await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'PATIENT_DOCUMENT_UPLOADED', entityType: 'PatientDocument', entityId: document.id, metadata: { patientId: id, mimeType, size: file.buffer.length } } });
      return document;
    } catch (error) {
      await unlink(storagePath).catch(() => undefined);
      throw error;
    }
  }

  async downloadDocument(patientId: string, documentId: string) {
    const scope = this.requireScope();
    await this.get(patientId);
    const document = await this.prisma.scoped.patientDocument.findFirst({
      where: { id: documentId, patientId },
      select: { id: true, originalName: true, mimeType: true, size: true, storageKey: true },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    const storagePath = join(this.patientDocumentsRoot(), scope.tenantId, document.storageKey);
    let content: Buffer;
    try { content = await readFile(storagePath); }
    catch { throw new NotFoundException('O arquivo deste documento não está disponível no armazenamento local.'); }
    await this.prisma.scoped.auditEvent.create({ data: { actorUserId: scope.userId, action: 'PATIENT_DOCUMENT_DOWNLOADED', entityType: 'PatientDocument', entityId: document.id, metadata: { patientId, mimeType: document.mimeType, size: document.size } } });
    return { fileName: document.originalName, mimeType: document.mimeType, contentBase64: content.toString('base64') };
  }

  private patientDocumentsRoot() {
    const localAppData = process.env.LOCALAPPDATA;
    const defaultDirectory = localAppData
      ? join(localAppData, 'EssencialClinica', 'patient-documents')
      : join(process.cwd(), '.private-data', 'patient-documents');
    return resolve(process.env.PATIENT_DOCUMENTS_DIR || defaultDirectory);
  }

  private detectPatientDocumentType(buffer: Buffer): string | null {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    return null;
  }

  async consentHistory(id: string) {
    const scope = this.requireScope();
    const patient = await this.get(id);
    const [preferences, events] = await Promise.all([
      this.prisma.scoped.consentPreference.findMany({
        where: { patientId: id },
        orderBy: [{ channel: 'asc' }, { purpose: 'asc' }],
      }),
      this.prisma.scoped.consentEvent.findMany({
        where: { patientId: id },
        include: { actor: { select: { id: true, displayName: true } } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return { patientId: patient.id, preferences, events, tenantId: scope.tenantId };
  }

  async listTags(id: string) {
    const patient = await this.get(id);
    return this.prisma.scoped.patientTag.findMany({
      where: { patientId: patient.id },
      include: { tag: { select: { id: true, name: true, color: true } } },
      orderBy: [{ tag: { name: 'asc' } }],
    });
  }

  async listTagDefinitions() {
    this.requireScope();
    return this.prisma.scoped.patientTagDefinition.findMany({
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, color: true },
    });
  }

  async addTag(id: string, input: Record<string, unknown>) {
    const scope = this.requireScope();
    const name = this.text(input.name, 'Nome da etiqueta', 2, 40);
    const color = input.color == null || input.color === '' ? '#64748b' : this.text(input.color, 'Cor', 4, 7);
    if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color)) throw new BadRequestException('Cor deve estar em hexadecimal.');
    return this.prisma.unscoped.$transaction(async (tx) => {
      const patient = await this.lockAndFindPatient(tx, id, scope, false);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.tenantId}:${name.toLocaleLowerCase('pt-BR')}`})) IS NULL AS locked`;
      let tag = await tx.patientTagDefinition.findFirst({ where: { tenantId: scope.tenantId, name: { equals: name, mode: 'insensitive' } } });
      if (!tag) {
        tag = await tx.patientTagDefinition.create({ data: { tenantId: scope.tenantId, name, color } });
      }
      await tx.patientTag.createMany({ data: [{ tenantId: scope.tenantId, patientId: patient.id, tagId: tag.id }], skipDuplicates: true });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PATIENT_TAG_ADDED', entityType: 'Patient', entityId: patient.id, metadata: { tagId: tag.id } } });
      return tag;
    });
  }

  async removeTag(id: string, tagId: string) {
    const scope = this.requireScope();
    return this.prisma.unscoped.$transaction(async (tx) => {
      const patient = await this.lockAndFindPatient(tx, id, scope, false);
      const tag = await tx.patientTagDefinition.findFirst({ where: { id: tagId, tenantId: scope.tenantId }, select: { id: true } });
      if (!tag) throw new NotFoundException('Etiqueta não encontrada.');
      const removed = await tx.patientTag.deleteMany({ where: { tenantId: scope.tenantId, patientId: patient.id, tagId } });
      if (removed.count) await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PATIENT_TAG_REMOVED', entityType: 'Patient', entityId: patient.id, metadata: { tagId } } });
      return { removed: removed.count > 0 };
    });
  }

  async listNotes(id: string) {
    const patient = await this.get(id);
    return this.prisma.scoped.patientNote.findMany({
      where: { patientId: patient.id },
      include: { author: { select: { id: true, displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  async addNote(id: string, input: Record<string, unknown>) {
    const scope = this.requireScope();
    const content = this.text(input.content, 'Nota', 1, 2000);
    return this.prisma.unscoped.$transaction(async (tx) => {
      const patient = await this.lockAndFindPatient(tx, id, scope, false);
      const note = await tx.patientNote.create({ data: { tenantId: scope.tenantId, patientId: patient.id, authorUserId: scope.userId, content } });
      await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PATIENT_NOTE_ADDED', entityType: 'Patient', entityId: patient.id } });
      return note;
    });
  }

  async importBatch(input: Record<string, unknown>) {
    const scope = this.requireScope();
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 500) {
      throw new BadRequestException('Envie de 1 a 500 linhas por lote CSV.');
    }
    const unitId = await this.validateUnit(input.unitId, scope);
    let imported = 0;
    let duplicates = 0;
    const errors: Array<{ row: number; message: string }> = [];
    const duplicateRows: number[] = [];

    for (let index = 0; index < input.rows.length; index++) {
      const row = input.rows[index];
      try {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BadRequestException('Linha inválida.');
        const data = row as Record<string, unknown>;
        const fullName = this.text(data.fullName, 'Nome', 2, 160);
        const phone = this.normalizePhone(data.phone);
        const email = this.normalizeEmail(data.email);
        const birthDate = this.dateValue(data.birthDate, 'Data de nascimento');
        const source = this.optionalText(data.source, 60) ?? 'CSV';
        const outcome = await this.prisma.unscoped.$transaction(async (tx) => {
          const dedupeKey = `${scope.tenantId}:${phone.normalized ?? email ?? `${fullName.toLocaleLowerCase('pt-BR')}:${index}`}`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey})) IS NULL AS locked`;
          const existing = await tx.patient.findFirst({
            where: { tenantId: scope.tenantId, OR: [
              ...(phone.normalized ? [{ phoneNormalized: phone.normalized }] : []),
              ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
            ] },
            select: { id: true },
          });
          if (existing) return 'duplicate' as const;
          await this.usage.assertCapacityWithinTransaction(tx, 'patients');
          const patient = await tx.patient.create({ data: { tenantId: scope.tenantId, unitId, fullName, phone: phone.display, phoneNormalized: phone.normalized, email, birthDate, source } });
          await tx.auditEvent.create({ data: { tenantId: scope.tenantId, actorUserId: scope.userId, action: 'PATIENT_IMPORTED', entityType: 'Patient', entityId: patient.id } });
          return 'imported' as const;
        });
        if (outcome === 'duplicate') { duplicates++; duplicateRows.push(index + 2); }
        else imported++;
      } catch (error) {
        errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'Falha ao importar linha.' });
      }
    }
    return { imported, duplicates, duplicateRows, errors, consent: 'UNKNOWN_UNLESS_SEPARATELY_RECORDED' };
  }

  async previewSpreadsheet(buffer: Buffer, fileName: string, requestedSheet?: string) {
    this.requireScope();
    if (!buffer?.length || buffer.length > 5 * 1024 * 1024) throw new BadRequestException('Arquivo vazio ou maior que 5 MB.');
    if (!/\.xlsx$/i.test(fileName) || /\.xlsm$/i.test(fileName)) throw new BadRequestException('Envie um arquivo .xlsx sem macros.');
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw new BadRequestException('Não foi possível ler a planilha XLSX. Verifique se o arquivo não está corrompido.');
    }
    const worksheets = workbook.worksheets.filter((sheet) => sheet.state === 'visible');
    if (!worksheets.length || worksheets.length > 20) throw new BadRequestException('O arquivo deve conter de 1 a 20 abas visíveis.');
    const sheet = requestedSheet
      ? worksheets.find((item) => item.name === requestedSheet)
      : worksheets[0];
    if (!sheet) throw new BadRequestException('A aba selecionada não existe ou não está visível.');
    if (sheet.rowCount > 501 || sheet.columnCount > 100) throw new BadRequestException('A aba excede o limite de 500 linhas de dados ou 100 colunas.');
    const values: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let column = 1; column <= sheet.columnCount; column++) {
        const cell = row.getCell(column);
        const value = cell.value;
        if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
          throw new BadRequestException(`Fórmula não permitida na linha ${rowNumber}, coluna ${column}. Copie e cole os valores antes de importar.`);
        }
        if (value instanceof Date) cells.push(`${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`);
        else if (value && typeof value === 'object' && 'richText' in value) cells.push(value.richText.map((part) => part.text).join('').slice(0, 2000));
        else if (value && typeof value === 'object' && 'text' in value) cells.push(String(value.text).slice(0, 2000));
        else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') cells.push(String(value).slice(0, 2000));
        else cells.push('');
      }
      if (cells.some((cell) => cell !== '')) values.push(cells);
    });
    if (values.length < 2) throw new BadRequestException('A aba está vazia ou não contém linhas de dados.');
    const headers = values[0].map((value) => value.trim().slice(0, 120));
    if (headers.every((value) => !value)) throw new BadRequestException('A primeira linha precisa conter os cabeçalhos das colunas.');
    return {
      sheetName: sheet.name,
      sheets: worksheets.map((item) => item.name),
      headers,
      rows: values.slice(1, 501),
      rowCount: values.length - 1,
      maxRows: 500,
      consent: 'UNKNOWN_UNLESS_SEPARATELY_RECORDED',
    };
  }

  async create(input: Record<string, unknown>) {
    const scope = this.requireScope();
    const fullName = this.text(input.fullName, 'Nome', 2, 160);
    const unitId = await this.validateUnit(input.unitId, scope);
    const phone = this.normalizePhone(input.phone);
    const email = this.normalizeEmail(input.email);
    const birthDate = this.dateValue(input.birthDate, 'Data de nascimento');
    const source = this.optionalText(input.source, 60);
    const consentStatus = this.choiceStatus(input.marketingConsent);
    const evidence = this.readEvidence(input, consentStatus);

    return this.prisma.unscoped.$transaction(async (tx) => {
      await this.assertUnitAccess(tx, scope, unitId);
      await this.usage.assertCapacityWithinTransaction(tx, 'patients');
      const patient = await tx.patient.create({
        data: {
          tenantId: scope.tenantId,
          unitId,
          fullName,
          phone: phone.display,
          phoneNormalized: phone.normalized,
          email,
          birthDate,
          source,
        },
      });
      await tx.consentEvent.create({
        data: {
          tenantId: scope.tenantId,
          patientId: patient.id,
          actorUserId: scope.userId,
          channel: 'WHATSAPP',
          purpose: 'MARKETING',
          status: consentStatus,
          source: 'MANUAL',
          ...evidence,
        },
      });
      await tx.consentPreference.create({
        data: {
          tenantId: scope.tenantId,
          patientId: patient.id,
          channel: 'WHATSAPP',
          purpose: 'MARKETING',
          status: consentStatus,
          source: 'MANUAL',
          ...evidence,
        },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: 'PATIENT_CREATED',
          entityType: 'Patient',
          entityId: patient.id,
        },
      });
      return patient;
    });
  }

  async update(id: string, input: Record<string, unknown>) {
    const scope = this.requireScope();
    const data: Prisma.PatientUpdateInput = {};
    if (input.fullName !== undefined) data.fullName = this.text(input.fullName, 'Nome', 2, 160);
    if (input.phone !== undefined) {
      const phone = this.normalizePhone(input.phone);
      data.phone = phone.display;
      data.phoneNormalized = phone.normalized;
    }
    if (input.email !== undefined) data.email = this.normalizeEmail(input.email);
    if (input.birthDate !== undefined) data.birthDate = this.dateValue(input.birthDate, 'Data de nascimento');
    if (input.source !== undefined) data.source = this.optionalText(input.source, 60);
    const nextUnitId = input.unitId !== undefined ? await this.validateUnit(input.unitId, scope) : undefined;

    return this.prisma.unscoped.$transaction(async (tx) => {
      const current = await this.lockAndFindPatient(tx, id, scope, false);
      if (nextUnitId !== undefined) {
        await this.assertUnitAccess(tx, scope, nextUnitId);
        data.unit = nextUnitId ? { connect: { tenantId_id: { tenantId: scope.tenantId, id: nextUnitId } } } : { disconnect: true };
      }
      const updated = await tx.patient.update({ where: { tenantId_id: { tenantId: scope.tenantId, id: current.id } }, data });
      await tx.auditEvent.create({
        data: {
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: 'PATIENT_UPDATED',
          entityType: 'Patient',
          entityId: id,
        },
      });
      return updated;
    });
  }

  async archive(id: string) {
    const scope = this.requireScope();
    if (scope.role !== 'TENANT_ADMIN' && scope.role !== 'UNIT_MANAGER') {
      throw new ForbiddenException('Permissão insuficiente para arquivar paciente.');
    }
    return this.prisma.unscoped.$transaction(async (tx) => {
      const patient = await this.lockAndFindPatient(tx, id, scope, false);
      const archivedAt = new Date();
      const updated = await tx.patient.update({
        where: { tenantId_id: { tenantId: scope.tenantId, id: patient.id } },
        data: { active: false, deletedAt: archivedAt },
      });
      const suppressed = await tx.outboxMessage.updateMany({
        where: {
          tenantId: scope.tenantId,
          patientId: id,
          status: { in: ['PENDING', 'PROCESSING'] },
        },
        data: { status: 'SUPPRESSED', suppressionReason: 'PATIENT_ARCHIVED' },
      });
      await tx.auditEvent.create({
        data: {
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: 'PATIENT_ARCHIVED',
          entityType: 'Patient',
          entityId: id,
          metadata: { suppressedOutboxCount: suppressed.count },
        },
      });
      return { patient: updated, suppressedOutboxCount: suppressed.count };
    });
  }

  async recordConsent(id: string, input: Record<string, unknown>) {
    const scope = this.requireScope();
    const channel = this.enumValue(input.channel, ConsentChannel, 'Canal');
    const purpose = this.enumValue(input.purpose, ConsentPurpose, 'Finalidade');
    const status = this.enumValue(input.status, ConsentStatus, 'Status');
    if (input.source !== 'MANUAL') {
      throw new BadRequestException('Este formulário só pode registrar eventos de origem manual.');
    }
    const evidence = this.readEvidence(input, status);
    const policyVersion = this.optionalText(input.policyVersion, 80);

    return this.prisma.unscoped.$transaction(async (tx) => {
      const patient = await this.lockAndFindPatient(tx, id, scope, false);
      const event = await tx.consentEvent.create({
        data: {
          tenantId: scope.tenantId,
          patientId: patient.id,
          actorUserId: scope.userId,
          channel,
          purpose,
          status,
          source: ConsentSource.MANUAL,
          policyVersion,
          ...evidence,
        },
      });
      await tx.consentPreference.upsert({
        where: {
          tenantId_patientId_channel_purpose: {
            tenantId: scope.tenantId,
            patientId: patient.id,
            channel,
            purpose,
          },
        },
        create: {
          tenantId: scope.tenantId,
          patientId: patient.id,
          channel,
          purpose,
          status,
          source: ConsentSource.MANUAL,
          policyVersion,
          ...evidence,
        },
        update: {
          status,
          source: ConsentSource.MANUAL,
          policyVersion,
          ...evidence,
          lastChangedAt: new Date(),
        },
      });
      let suppressedCount = 0;
      if (status !== ConsentStatus.GRANTED) {
        const suppressed = await tx.outboxMessage.updateMany({
          where: {
            tenantId: scope.tenantId,
            patientId: patient.id,
            channel,
            purpose,
            status: { in: ['PENDING', 'PROCESSING'] },
          },
          data: { status: 'SUPPRESSED', suppressionReason: 'CONSENT_REVOKED' },
        });
        suppressedCount = suppressed.count;
      }
      let cancelledNpsCount = 0;
      if (status !== ConsentStatus.GRANTED && purpose === ConsentPurpose.SATISFACTION_SURVEY) {
        const cancelled = await tx.npsSurvey.updateMany({
          where: { tenantId: scope.tenantId, patientId: patient.id, status: 'PLANNED' },
          data: { status: 'CANCELLED' },
        });
        cancelledNpsCount = cancelled.count;
      }
      await tx.auditEvent.create({
        data: {
          tenantId: scope.tenantId,
          actorUserId: scope.userId,
          action: 'PATIENT_CONSENT_CHANGED',
          entityType: 'ConsentPreference',
          entityId: patient.id,
          metadata: { channel, purpose, status, suppressedCount, cancelledNpsCount },
        },
      });
      return event;
    });
  }

  private requireScope(): TenantScope {
    const scope = this.context.current();
    if (!scope) throw new ForbiddenException('Tenant obrigatório.');
    return scope;
  }

  private async allowedUnits(scope: TenantScope): Promise<string[] | null> {
    if (scope.role === 'TENANT_ADMIN' || scope.role === 'PLATFORM_SUPERADMIN') return null;
    const rows = await this.prisma.scoped.unitMembership.findMany({
      where: { tenantId: scope.tenantId, membershipId: scope.membershipId },
      select: { unitId: true },
    });
    return rows.map(({ unitId }) => unitId);
  }

  private async validateUnit(value: unknown, scope: TenantScope): Promise<string | null> {
    if (value == null || value === '') {
      if (scope.role !== 'TENANT_ADMIN' && scope.role !== 'PLATFORM_SUPERADMIN') {
        throw new BadRequestException('Selecione uma unidade autorizada.');
      }
      return null;
    }
    if (typeof value !== 'string') throw new BadRequestException('Unidade inválida.');
    const unit = await this.prisma.scoped.unit.findFirst({
      where: { id: value, active: true },
      select: { id: true },
    });
    if (!unit) throw new BadRequestException('Unidade inválida para este tenant.');
    const allowed = await this.allowedUnits(scope);
    if (allowed && !allowed.includes(value)) throw new ForbiddenException('Unidade fora do escopo do usuário.');
    return unit.id;
  }

  private async assertUnitAccess(tx: Prisma.TransactionClient, scope: TenantScope, unitId: string | null) {
    if (!unitId) return;
    const unit = await tx.unit.findFirst({ where: { id: unitId, tenantId: scope.tenantId, active: true }, select: { id: true } });
    if (!unit) throw new BadRequestException('Unidade inválida para este tenant.');
    if (scope.role !== 'TENANT_ADMIN' && scope.role !== 'PLATFORM_SUPERADMIN') {
      const membership = await tx.unitMembership.findFirst({
        where: { tenantId: scope.tenantId, membershipId: scope.membershipId, unitId },
        select: { unitId: true },
      });
      if (!membership) throw new ForbiddenException('Unidade fora do escopo do usuário.');
    }
  }

  private async assertPatientUnitAccess(scope: TenantScope, unitId: string | null) {
    if (scope.role === 'TENANT_ADMIN' || scope.role === 'PLATFORM_SUPERADMIN') return;
    if (!unitId) throw new NotFoundException('Paciente não encontrado no escopo do usuário.');
    const membership = await this.prisma.scoped.unitMembership.findFirst({
      where: { tenantId: scope.tenantId, membershipId: scope.membershipId, unitId },
      select: { unitId: true },
    });
    if (!membership) throw new NotFoundException('Paciente não encontrado no escopo do usuário.');
  }

  private async lockAndFindPatient(
    tx: Prisma.TransactionClient,
    id: string,
    scope: TenantScope,
    includeArchived: boolean,
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new NotFoundException('Paciente não encontrado.');
    }
    await tx.$queryRaw`SELECT id FROM "Patient" WHERE "tenantId" = ${scope.tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const patient = await tx.patient.findFirst({ where: { id, tenantId: scope.tenantId } });
    if (!patient || (!includeArchived && patient.deletedAt)) throw new NotFoundException('Paciente não encontrado.');
    if (scope.role !== 'TENANT_ADMIN' && scope.role !== 'PLATFORM_SUPERADMIN' && !patient.unitId) {
      throw new NotFoundException('Paciente não encontrado no escopo do usuário.');
    }
    await this.assertUnitAccess(tx, scope, patient.unitId);
    return patient;
  }

  private choiceStatus(value: unknown): ConsentStatus {
    if (value !== ConsentStatus.GRANTED && value !== ConsentStatus.DENIED) {
      throw new BadRequestException('Escolha de consentimento inválida.');
    }
    return value;
  }

  private readEvidence(input: Record<string, unknown>, status: ConsentStatus) {
    const evidenceType = input.evidenceType == null || input.evidenceType === ''
      ? null
      : this.enumValue(input.evidenceType, ConsentEvidenceType, 'Tipo de evidência');
    const evidenceReference = this.optionalText(input.evidenceReference, 255);
    const evidence = this.optionalText(input.evidence, 1000);
    const referenceLooksLikePlaceholder = evidenceReference != null && /^(sim|ok|manual|checkbox|autorizado|true)$/i.test(evidenceReference);
    if (status === ConsentStatus.GRANTED && (!evidenceType || !evidenceReference || evidenceReference.length < 5 || referenceLooksLikePlaceholder)) {
      throw new BadRequestException('Concessão exige tipo de evidência e referência identificável (protocolo, ID de mensagem ou documento).');
    }
    return { evidenceType, evidenceReference, evidence };
  }

  private normalizePhone(value: unknown): { display: string | null; normalized: string | null } {
    const display = this.optionalText(value, 40);
    if (!display) return { display: null, normalized: null };
    const normalized = display.replace(/\D/g, '');
    if (normalized.length < 10 || normalized.length > 15) {
      throw new BadRequestException('Telefone deve conter entre 10 e 15 dígitos.');
    }
    return { display, normalized };
  }

  private normalizeEmail(value: unknown): string | null {
    const email = this.optionalText(value, 254)?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('E-mail inválido.');
    return email;
  }

  private dateValue(value: unknown, label: string): Date | null {
    if (value == null || value === '') return null;
    const input = String(value).trim();
    const brazilianDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(input);
    const date = brazilianDate
      ? new Date(Date.UTC(Number(brazilianDate[3]), Number(brazilianDate[2]) - 1, Number(brazilianDate[1])))
      : new Date(input);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label} inválida.`);
    if (brazilianDate && (date.getUTCDate() !== Number(brazilianDate[1]) || date.getUTCMonth() !== Number(brazilianDate[2]) - 1 || date.getUTCFullYear() !== Number(brazilianDate[3]))) throw new BadRequestException(`${label} inválida.`);
    return date;
  }

  private patientStatus(value?: string): PatientStatusFilter {
    if (value == null || value === '' || value === 'ACTIVE') return 'ACTIVE';
    if (value === 'ARCHIVED' || value === 'ALL') return value;
    throw new BadRequestException('Filtro de status inválido.');
  }

  private positiveInteger(value: string | undefined, fallback: number, max: number, label: string) {
    if (value == null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new BadRequestException(`${label} inválida.`);
    return parsed;
  }

  private text(value: unknown, field: string, min: number, max: number) {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new BadRequestException(`${field} inválido.`);
    assertReadableMessageText(value, field.toLocaleLowerCase('pt-BR'));
    return value.trim();
  }

  private optionalText(value: unknown, max: number): string | null {
    if (value == null || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max) throw new BadRequestException('Campo de texto inválido.');
    assertReadableMessageText(value, 'campo de texto');
    return value.trim() || null;
  }

  private enumValue<T extends Record<string, string>>(value: unknown, values: T, label: string): T[keyof T] {
    if (typeof value !== 'string' || !Object.values(values).includes(value)) throw new BadRequestException(`${label} inválido.`);
    return value as T[keyof T];
  }
}
