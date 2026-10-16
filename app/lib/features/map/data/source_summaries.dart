/// Structured facts that ingestion connectors pack into one `summary`
/// sentence, recovered for display.
///
/// The map contract carries these facts only as text (see the connectors under
/// `cloud/data/src/connectors`). Parsing is presentation only: a summary that
/// does not match its connector's exact sentence returns null and is shown as
/// written, so a format change degrades to plain text rather than wrong facts.
library;

/// `com_development_monitor`: "Development project X0003803 at 475-485
/// Flinders Lane, Melbourne, 3000. Status: approved (source: APPROVED).
/// Dwellings: 0, Floors: 24. Application: TP-2018-263/B."
final class DevelopmentProjectSummary {
  const DevelopmentProjectSummary({
    required this.projectKey,
    required this.address,
    required this.status,
    required this.sourceStatus,
    required this.dwellings,
    required this.floors,
    required this.application,
  });

  /// Development Activity Monitor project key, such as `X0003803`.
  final String projectKey;
  final String address;

  /// Normalised connector status: mooted, approved, under_construction or
  /// completed.
  final String status;

  /// The council's own status text, such as `UNDER CONSTRUCTION`.
  final String sourceStatus;

  /// Null when the source leaves the count unspecified.
  final int? dwellings;
  final int? floors;

  /// Town planning application number; null when the source has none.
  final String? application;

  static final _pattern = RegExp(
    r'^Development project (\S+) at (.+)\. Status: ([a-z_]+) '
    r'\(source: ([^)]*)\)\. Dwellings: (\d+|unspecified), '
    r'Floors: (\d+(?:\.\d+)?|unspecified)\. Application: (.+)\.$',
  );

  static DevelopmentProjectSummary? tryParse(String? summary) {
    final match = summary == null ? null : _pattern.firstMatch(summary.trim());
    if (match == null) return null;
    final application = match[7]!.trim();
    return DevelopmentProjectSummary(
      projectKey: match[1]!,
      address: match[2]!.trim(),
      status: match[3]!,
      sourceStatus: match[4]!.trim(),
      dwellings: int.tryParse(match[5]!),
      floors: num.tryParse(match[6]!)?.round(),
      application: application == 'N/A' ? null : application,
    );
  }

  /// The connector titles a project "<address> (<SOURCE STATUS>)"; the status
  /// is shown separately, so the address alone is the readable title.
  static String cleanTitle(String title, DevelopmentProjectSummary summary) {
    final suffix = ' (${summary.sourceStatus})';
    return title.endsWith(suffix)
        ? title.substring(0, title.length - suffix.length)
        : title;
  }
}

/// `council_engagement`: "Community consultation by City of Yarra; status:
/// Open; categories: Parks, Transport +2 more; suburbs: Richmond, Abbotsford"
/// (or "area: council-wide").
final class CouncilConsultationSummary {
  const CouncilConsultationSummary({
    required this.council,
    required this.status,
    required this.categories,
    required this.suburbs,
    required this.councilWide,
  });

  final String council;

  /// Open, Active or Closed, as the council lists it.
  final String status;

  /// Listed categories, including a trailing "+N more" entry when truncated.
  final List<String> categories;
  final List<String> suburbs;
  final bool councilWide;

  static const _prefix = 'Community consultation by ';

  static CouncilConsultationSummary? tryParse(String? summary) {
    if (summary == null || !summary.startsWith(_prefix)) return null;
    final parts = summary.substring(_prefix.length).split('; ');
    final council = parts.first.trim();
    String? status;
    var categories = const <String>[];
    var suburbs = const <String>[];
    var councilWide = false;
    for (final part in parts.skip(1)) {
      final split = part.indexOf(': ');
      if (split < 0) return null;
      final value = part.substring(split + 2).trim();
      switch (part.substring(0, split)) {
        case 'status':
          status = value;
        case 'categories':
          categories = _list(value);
        case 'suburbs':
          suburbs = _list(value);
        case 'area' when value == 'council-wide':
          councilWide = true;
        default:
          return null;
      }
    }
    if (council.isEmpty || status == null) return null;
    return CouncilConsultationSummary(
      council: council,
      status: status,
      categories: categories,
      suburbs: suburbs,
      councilWide: councilWide,
    );
  }
}

/// `ticketmaster`: "Event information provided by Ticketmaster; Ticketmaster
/// status: onsale; local start: 2026-11-03 09:30:00 Australia/Melbourne;
/// venue: Flemington Racecourse". The leading attribution is optional.
final class TicketmasterSummary {
  const TicketmasterSummary({required this.ticketStatus, required this.venue});

  /// Lower-case Ticketmaster sale status: onsale, offsale, cancelled,
  /// canceled, postponed or rescheduled.
  final String ticketStatus;

  /// Null when Ticketmaster names no single venue.
  final String? venue;

  static final _pattern = RegExp(
    r'^(?:Event information provided by Ticketmaster; )?'
    r'Ticketmaster status: ([^;]*); local start: [^;]*; venue: (.*)$',
  );

  static TicketmasterSummary? tryParse(String? summary) {
    final match = summary == null ? null : _pattern.firstMatch(summary.trim());
    if (match == null) return null;
    final venue = match[2]!.trim();
    return TicketmasterSummary(
      ticketStatus: match[1]!.trim().toLowerCase(),
      venue: venue.isEmpty || venue == 'unknown' || venue == 'multiple venues'
          ? null
          : venue,
    );
  }
}

/// Anomaly baseline definitions such as `same-hour-prev-7d-mean-v1`: the mean
/// of the same hour over the previous N days. Returns N, or null for any other
/// definition.
int? sameHourBaselineDays(String? definitionId) {
  final match = definitionId == null
      ? null
      : RegExp(r'^same-hour-prev-(\d+)d-mean-v\d+$').firstMatch(definitionId);
  return match == null ? null : int.tryParse(match[1]!);
}

List<String> _list(String value) => [
  for (final entry in value.split(', '))
    if (entry.trim().isNotEmpty) entry.trim(),
];
