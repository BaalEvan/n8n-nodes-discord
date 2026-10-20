var FLOW_COMMANDS = {
	b2b: {
		slash: 'invoice-b2b',
		files: ['invoice'],
		date: 'sell_date',
		hours: 'hours',
		description: null,
		employee: true,
	},
	zlecenie: {
		slash: 'invoice-zlecenie',
		files: ['timesheet', 'bill'],
		date: 'month_date',
		hours: null,
		description: null,
		employee: true,
	},
	client: {
		slash: 'invoice-client',
		files: ['invoice'],
		date: 'invoice_date',
		hours: null,
		description: 'description',
		employee: false,
	},
};

var FLOW_CONFIG_KEYS = [
	'invoiceDriveRootId',
	'invoiceNotifyChannelId',
	'driveFolderHelperWorkflowId',
];

var FLOW_STATUS_MESSAGES = {
	401: 'Authorization failed - please check your credentials',
	403: 'Forbidden - perhaps check your credentials?',
};

var FLOW_AUTH_TEXT =
	/authorization grant|invalid_grant|Token has been expired or revoked|invalid_token/i;

function flowAuthText(item) {
	return FLOW_AUTH_TEXT.test(JSON.stringify(item === undefined ? null : item));
}

function flowDisplayName(interaction) {
	var inter = interaction || {};
	var member = inter.member || {};
	var user = inter.user || member.user || {};
	return text(member.nick) || text(user.global_name) || text(user.username);
}

function flowChoices(command, interaction, nowMs) {
	var spec = FLOW_COMMANDS[command];
	var options = (interaction && interaction.options) || {};
	var typed = text(options[spec.date]);
	return {
		choices: dateSuggestions(nowMs).filter(function (c) {
			return c.value.indexOf(typed) === 0;
		}),
	};
}

function flowInput(command, interaction) {
	var spec = FLOW_COMMANDS[command];
	var inter = interaction || {};
	var options = inter.options || {};
	var resolved = (inter.resolved && inter.resolved.attachments) || {};
	var attachments = {};
	for (var i = 0; i < spec.files.length; i++) {
		var option = spec.files[i];
		var id = options[option];
		var a = id === undefined || id === null ? undefined : resolved[id];
		var problem = checkAttachment(a, option);
		if (problem) return { ok: false, content: problem };
		attachments[option] = {
			url: text(a.url),
			filename: text(a.filename),
			size: Number(a.size),
			content_type: text(a.content_type),
		};
	}
	var date = parseDate(options[spec.date]);
	if (!date.ok) return { ok: false, content: badDate(spec.date) };
	var hours = spec.hours ? options[spec.hours] : undefined;
	return {
		ok: true,
		command: command,
		userId: text(inter.userId),
		displayName: flowDisplayName(inter),
		date: { year: date.year, month: date.month, iso: date.iso },
		hours: hours === undefined ? null : hours,
		description: spec.description ? text(options[spec.description]) : '',
		attachments: attachments,
	};
}

function flowConfig(rows) {
	var cfg = {};
	(rows || []).forEach(function (r) {
		if (r && r.key) cfg[r.key] = text(r.value);
	});
	return cfg;
}

function flowQuoted(value) {
	return text(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function flowPlan(command, input, employees, config) {
	var spec = FLOW_COMMANDS[command];
	var cfg = flowConfig(config);
	var channelId = cfg.invoiceNotifyChannelId || '';
	var userId = input.userId;
	var stop = function (content, note) {
		return { action: 'stop', content: content, note: note, channelId: channelId };
	};
	var rows = (employees || []).filter(function (r) {
		return r && Object.keys(r).length > 0;
	});
	var broken = rows.filter(function (r) {
		return r.error !== undefined && r.discordID === undefined;
	})[0];
	if (broken) {
		return stop(
			replies.FAILED,
			failureNote(spec.slash, userId, 'employee', driveError(broken).message, false),
		);
	}
	var unread = (config || []).filter(function (r) {
		return r && r.error !== undefined && r.key === undefined;
	})[0];
	if (unread) {
		return stop(
			replies.FAILED,
			failureNote(spec.slash, userId, 'config', driveError(unread).message, false),
		);
	}
	var found = findEmployee(rows, userId);
	var row = found.ok ? found.row : null;
	if (spec.employee) {
		if (found.reason === 'none')
			return stop(replies.NOT_REGISTERED, notRegisteredNote(spec.slash, userId));
		if (found.reason === 'ambiguous') {
			return stop(replies.AMBIGUOUS, ambiguousNote(spec.slash, userId, found.count));
		}
		var missing = missingFields(command, row);
		if (missing.length)
			return stop(replies.INCOMPLETE, incompleteNote(spec.slash, userId, missing));
	}
	var absent = FLOW_CONFIG_KEYS.filter(function (k) {
		return !cfg[k];
	});
	if (absent.length) {
		return stop(
			replies.FAILED,
			failureNote(
				spec.slash,
				userId,
				'config',
				'missing discord_config ' + absent.join(', '),
				false,
			),
		);
	}
	var named = names(command, row, { date: input.date.iso, attachments: input.attachments });
	return {
		action: 'upload',
		command: command,
		slash: spec.slash,
		userId: userId,
		displayName: input.displayName,
		channelId: channelId,
		rootId: cfg.invoiceDriveRootId,
		helperId: cfg.driveFolderHelperWorkflowId,
		year: input.date.year,
		month: input.date.month,
		date: input.date.iso,
		hours: input.hours,
		description: input.description,
		row: row,
		personFolder: named.personFolder,
		files: named.files.map(function (f) {
			return {
				option: f.option,
				fileName: f.fileName,
				quotedName: flowQuoted(f.fileName),
				url: input.attachments[f.option].url,
			};
		}),
	};
}

function flowLastStep(pairs) {
	var step = '';
	(pairs || []).forEach(function (p) {
		if (p[1]) step = p[0];
	});
	return step;
}

function flowUploaded(plan, step) {
	var files = (plan && plan.files) || [];
	var option = text(step).split(': ')[0];
	var at = files
		.map(function (f) {
			return f.option;
		})
		.indexOf(option);
	return files.slice(0, Math.max(at, 0)).map(function (f) {
		return f.fileName;
	});
}

function flowWithCode(message, code) {
	return code ? message + ' (HTTP ' + code + ')' : message;
}

function flowRequestError(item, drive) {
	var d = driveError(item);
	var code = d.httpCode;
	if (!code) {
		Object.keys(FLOW_STATUS_MESSAGES).forEach(function (k) {
			if (d.message.indexOf(FLOW_STATUS_MESSAGES[k]) === 0) code = Number(k);
		});
	}
	var auth =
		drive &&
		(isDriveAuthError({
			httpCode: code,
			url: d.raw.url,
			message: d.raw.message,
			description: d.raw.description,
		}) ||
			flowAuthText(item));
	return { reason: flowWithCode(d.message, code), auth: auth === true };
}

function flowFailure(plan, step, item, uploaded) {
	var p = plan || {};
	var info;
	if (step) {
		var e = flowRequestError(item, step.split(': ').pop() !== 'download');
		info = { step: step, reason: e.reason, auth: e.auth };
	} else {
		var f = folderFailure('folder', item).error;
		info = {
			step: f.step,
			reason: flowWithCode(f.message, f.httpCode),
			auth: f.auth === true || flowAuthText(item),
		};
	}
	var done = uploaded || [];
	var reason = info.reason;
	if (done.length) {
		reason +=
			'; already uploaded: ' +
			done
				.map(function (n) {
					return '`' + n + '`';
				})
				.join(', ');
	}
	return {
		action: 'stop',
		content: replies.FAILED,
		note: failureNote(p.slash, p.userId, info.step, reason, info.auth),
		channelId: text(p.channelId),
	};
}

function flowFileLinks(upload) {
	var u = upload || {};
	var id = text(u.id);
	return {
		id: id,
		webViewLink:
			text(u.webViewLink) ||
			(id ? 'https://drive.google.com/file/d/' + id + '/view?usp=drivesdk' : ''),
		webContentLink:
			text(u.webContentLink) ||
			(id ? 'https://drive.google.com/uc?id=' + id + '&export=download' : ''),
	};
}

function flowNotice(plan, links) {
	var row = plan.row || {};
	var who = text(row.shortname) || text(row.fullname);
	if (plan.command === 'b2b') {
		return b2bNotice({
			shortname: who,
			hours: plan.hours,
			month: plan.month,
			year: plan.year,
			webContentLink: links[0].webContentLink,
			webViewLink: links[0].webViewLink,
		});
	}
	if (plan.command === 'zlecenie') {
		return zlecenieNotice({
			shortname: who,
			month: plan.month,
			year: plan.year,
			timesheetLink: links[0].webViewLink,
			billLink: links[1].webViewLink,
		});
	}
	return clientNotice({
		fileName: plan.files[0].fileName,
		month: plan.month,
		year: plan.year,
		description: plan.description,
		webContentLink: links[0].webContentLink,
		webViewLink: links[0].webViewLink,
		uploader: text(row.shortname) || plan.displayName,
	});
}

function flowSuccess(plan, folder, uploads, existing) {
	var files = plan.files || [];
	var links = files.map(function (f, i) {
		return flowFileLinks(uploads && uploads[i]);
	});
	var dups = files
		.filter(function (f, i) {
			var e = existing && existing[i];
			return Boolean(e && Array.isArray(e.files) && e.files.length > 0);
		})
		.map(function (f) {
			return f.fileName;
		});
	return {
		content: successReply(
			files.map(function (f) {
				return f.fileName;
			}),
			text(folder && folder.path),
			dups,
		),
		notice: flowNotice(plan, links),
		channelId: text(plan.channelId),
	};
}

if (typeof module !== 'undefined')
	module.exports = {
		FLOW_COMMANDS,
		FLOW_CONFIG_KEYS,
		flowDisplayName,
		flowChoices,
		flowInput,
		flowConfig,
		flowQuoted,
		flowPlan,
		flowLastStep,
		flowUploaded,
		flowFailure,
		flowFileLinks,
		flowSuccess,
	};
