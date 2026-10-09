// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'agent_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
TurnInput _$TurnInputFromJson(
  Map<String, dynamic> json
) {
        switch (json['kind']) {
                  case 'text':
          return TextTurnInput.fromJson(
            json
          );
                case 'area':
          return AreaTurnInput.fromJson(
            json
          );
                case 'analyse':
          return AnalyseTurnInput.fromJson(
            json
          );
                case 'answer':
          return AnswerTurnInput.fromJson(
            json
          );
        
          default:
            throw CheckedFromJsonException(
  json,
  'kind',
  'TurnInput',
  'Invalid union type "${json['kind']}"!'
);
        }
      
}

/// @nodoc
mixin _$TurnInput {



  /// Serializes this TurnInput to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is TurnInput);
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
    return 'TurnInput()';
}


}

/// @nodoc
class $TurnInputCopyWith<$Res>  {
$TurnInputCopyWith(TurnInput _, $Res Function(TurnInput) __);
}


/// Adds pattern-matching-related methods to [TurnInput].
extension TurnInputPatterns on TurnInput {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( TextTurnInput value)?  text,TResult Function( AreaTurnInput value)?  area,TResult Function( AnalyseTurnInput value)?  analyse,TResult Function( AnswerTurnInput value)?  answer,required TResult orElse(),}){
final _that = this;
switch (_that) {
case TextTurnInput() when text != null:
return text(_that);case AreaTurnInput() when area != null:
return area(_that);case AnalyseTurnInput() when analyse != null:
return analyse(_that);case AnswerTurnInput() when answer != null:
return answer(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( TextTurnInput value)  text,required TResult Function( AreaTurnInput value)  area,required TResult Function( AnalyseTurnInput value)  analyse,required TResult Function( AnswerTurnInput value)  answer,}){
final _that = this;
switch (_that) {
case TextTurnInput():
return text(_that);case AreaTurnInput():
return area(_that);case AnalyseTurnInput():
return analyse(_that);case AnswerTurnInput():
return answer(_that);}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( TextTurnInput value)?  text,TResult? Function( AreaTurnInput value)?  area,TResult? Function( AnalyseTurnInput value)?  analyse,TResult? Function( AnswerTurnInput value)?  answer,}){
final _that = this;
switch (_that) {
case TextTurnInput() when text != null:
return text(_that);case AreaTurnInput() when area != null:
return area(_that);case AnalyseTurnInput() when analyse != null:
return analyse(_that);case AnswerTurnInput() when answer != null:
return answer(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function(@JsonKey(required: true)  String text)?  text,TResult Function(@JsonKey(required: true)  double lat, @JsonKey(required: true)  double lng)?  area,TResult Function(@JsonKey(required: true)  String featureId)?  analyse,TResult Function(@JsonKey(required: true)  String questionId, @JsonKey(required: true)  String value)?  answer,required TResult orElse(),}) {final _that = this;
switch (_that) {
case TextTurnInput() when text != null:
return text(_that.text);case AreaTurnInput() when area != null:
return area(_that.lat,_that.lng);case AnalyseTurnInput() when analyse != null:
return analyse(_that.featureId);case AnswerTurnInput() when answer != null:
return answer(_that.questionId,_that.value);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function(@JsonKey(required: true)  String text)  text,required TResult Function(@JsonKey(required: true)  double lat, @JsonKey(required: true)  double lng)  area,required TResult Function(@JsonKey(required: true)  String featureId)  analyse,required TResult Function(@JsonKey(required: true)  String questionId, @JsonKey(required: true)  String value)  answer,}) {final _that = this;
switch (_that) {
case TextTurnInput():
return text(_that.text);case AreaTurnInput():
return area(_that.lat,_that.lng);case AnalyseTurnInput():
return analyse(_that.featureId);case AnswerTurnInput():
return answer(_that.questionId,_that.value);}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function(@JsonKey(required: true)  String text)?  text,TResult? Function(@JsonKey(required: true)  double lat, @JsonKey(required: true)  double lng)?  area,TResult? Function(@JsonKey(required: true)  String featureId)?  analyse,TResult? Function(@JsonKey(required: true)  String questionId, @JsonKey(required: true)  String value)?  answer,}) {final _that = this;
switch (_that) {
case TextTurnInput() when text != null:
return text(_that.text);case AreaTurnInput() when area != null:
return area(_that.lat,_that.lng);case AnalyseTurnInput() when analyse != null:
return analyse(_that.featureId);case AnswerTurnInput() when answer != null:
return answer(_that.questionId,_that.value);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class TextTurnInput implements TurnInput {
  const TextTurnInput({@JsonKey(required: true) required this.text,  String? $type}): $type = $type ?? 'text';
  factory TextTurnInput.fromJson(Map<String, dynamic> json) => _$TextTurnInputFromJson(json);

@JsonKey(required: true) final  String text;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TextTurnInputCopyWith<TextTurnInput> get copyWith => _$TextTurnInputCopyWithImpl<TextTurnInput>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TextTurnInputToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is TextTurnInput&&(identical(other.text, text) || other.text == text));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,text);
}

@override
String toString() {
    return 'TurnInput.text(text: $text)';
}


}

/// @nodoc
abstract mixin class $TextTurnInputCopyWith<$Res> implements $TurnInputCopyWith<$Res> {
  factory $TextTurnInputCopyWith(TextTurnInput value, $Res Function(TextTurnInput) _then) = _$TextTurnInputCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String text
});




}
/// @nodoc
class _$TextTurnInputCopyWithImpl<$Res>
    implements $TextTurnInputCopyWith<$Res> {
  _$TextTurnInputCopyWithImpl(this._self, this._then);

  final TextTurnInput _self;
  final $Res Function(TextTurnInput) _then;

/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? text = null,}) {
  return _then(TextTurnInput(
text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AreaTurnInput implements TurnInput {
  const AreaTurnInput({@JsonKey(required: true) required this.lat, @JsonKey(required: true) required this.lng,  String? $type}): $type = $type ?? 'area';
  factory AreaTurnInput.fromJson(Map<String, dynamic> json) => _$AreaTurnInputFromJson(json);

@JsonKey(required: true) final  double lat;
@JsonKey(required: true) final  double lng;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AreaTurnInputCopyWith<AreaTurnInput> get copyWith => _$AreaTurnInputCopyWithImpl<AreaTurnInput>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AreaTurnInputToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AreaTurnInput&&(identical(other.lat, lat) || other.lat == lat)&&(identical(other.lng, lng) || other.lng == lng));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,lat,lng);
}

@override
String toString() {
    return 'TurnInput.area(lat: $lat, lng: $lng)';
}


}

/// @nodoc
abstract mixin class $AreaTurnInputCopyWith<$Res> implements $TurnInputCopyWith<$Res> {
  factory $AreaTurnInputCopyWith(AreaTurnInput value, $Res Function(AreaTurnInput) _then) = _$AreaTurnInputCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) double lat,@JsonKey(required: true) double lng
});




}
/// @nodoc
class _$AreaTurnInputCopyWithImpl<$Res>
    implements $AreaTurnInputCopyWith<$Res> {
  _$AreaTurnInputCopyWithImpl(this._self, this._then);

  final AreaTurnInput _self;
  final $Res Function(AreaTurnInput) _then;

/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? lat = null,Object? lng = null,}) {
  return _then(AreaTurnInput(
lat: null == lat ? _self.lat : lat // ignore: cast_nullable_to_non_nullable
as double,lng: null == lng ? _self.lng : lng // ignore: cast_nullable_to_non_nullable
as double,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AnalyseTurnInput implements TurnInput {
  const AnalyseTurnInput({@JsonKey(required: true) required this.featureId,  String? $type}): $type = $type ?? 'analyse';
  factory AnalyseTurnInput.fromJson(Map<String, dynamic> json) => _$AnalyseTurnInputFromJson(json);

@JsonKey(required: true) final  String featureId;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AnalyseTurnInputCopyWith<AnalyseTurnInput> get copyWith => _$AnalyseTurnInputCopyWithImpl<AnalyseTurnInput>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AnalyseTurnInputToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AnalyseTurnInput&&(identical(other.featureId, featureId) || other.featureId == featureId));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,featureId);
}

@override
String toString() {
    return 'TurnInput.analyse(featureId: $featureId)';
}


}

/// @nodoc
abstract mixin class $AnalyseTurnInputCopyWith<$Res> implements $TurnInputCopyWith<$Res> {
  factory $AnalyseTurnInputCopyWith(AnalyseTurnInput value, $Res Function(AnalyseTurnInput) _then) = _$AnalyseTurnInputCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String featureId
});




}
/// @nodoc
class _$AnalyseTurnInputCopyWithImpl<$Res>
    implements $AnalyseTurnInputCopyWith<$Res> {
  _$AnalyseTurnInputCopyWithImpl(this._self, this._then);

  final AnalyseTurnInput _self;
  final $Res Function(AnalyseTurnInput) _then;

/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? featureId = null,}) {
  return _then(AnalyseTurnInput(
featureId: null == featureId ? _self.featureId : featureId // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AnswerTurnInput implements TurnInput {
  const AnswerTurnInput({@JsonKey(required: true) required this.questionId, @JsonKey(required: true) required this.value,  String? $type}): $type = $type ?? 'answer';
  factory AnswerTurnInput.fromJson(Map<String, dynamic> json) => _$AnswerTurnInputFromJson(json);

@JsonKey(required: true) final  String questionId;
@JsonKey(required: true) final  String value;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AnswerTurnInputCopyWith<AnswerTurnInput> get copyWith => _$AnswerTurnInputCopyWithImpl<AnswerTurnInput>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AnswerTurnInputToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AnswerTurnInput&&(identical(other.questionId, questionId) || other.questionId == questionId)&&(identical(other.value, value) || other.value == value));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,questionId,value);
}

@override
String toString() {
    return 'TurnInput.answer(questionId: $questionId, value: $value)';
}


}

/// @nodoc
abstract mixin class $AnswerTurnInputCopyWith<$Res> implements $TurnInputCopyWith<$Res> {
  factory $AnswerTurnInputCopyWith(AnswerTurnInput value, $Res Function(AnswerTurnInput) _then) = _$AnswerTurnInputCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String questionId,@JsonKey(required: true) String value
});




}
/// @nodoc
class _$AnswerTurnInputCopyWithImpl<$Res>
    implements $AnswerTurnInputCopyWith<$Res> {
  _$AnswerTurnInputCopyWithImpl(this._self, this._then);

  final AnswerTurnInput _self;
  final $Res Function(AnswerTurnInput) _then;

/// Create a copy of TurnInput
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? questionId = null,Object? value = null,}) {
  return _then(AnswerTurnInput(
questionId: null == questionId ? _self.questionId : questionId // ignore: cast_nullable_to_non_nullable
as String,value: null == value ? _self.value : value // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

AgentEvent _$AgentEventFromJson(
  Map<String, dynamic> json
) {
        switch (json['event']) {
                  case 'status':
          return AgentStatusEvent.fromJson(
            json
          );
                case 'text':
          return AgentTextEvent.fromJson(
            json
          );
                case 'ui_action':
          return AgentUiActionEvent.fromJson(
            json
          );
                case 'card':
          return AgentCardEvent.fromJson(
            json
          );
                case 'question':
          return AgentQuestionEvent.fromJson(
            json
          );
                case 'usage':
          return AgentUsageEvent.fromJson(
            json
          );
                case 'done':
          return AgentDoneEvent.fromJson(
            json
          );
                case 'error':
          return AgentErrorEvent.fromJson(
            json
          );
        
          default:
            throw CheckedFromJsonException(
  json,
  'event',
  'AgentEvent',
  'Invalid union type "${json['event']}"!'
);
        }
      
}

/// @nodoc
mixin _$AgentEvent {

@JsonKey(required: true) String get turnId;@JsonKey(required: true) int get seq;
/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentEventCopyWith<AgentEvent> get copyWith => _$AgentEventCopyWithImpl<AgentEvent>(this as AgentEvent, _$identity);

  /// Serializes this AgentEvent to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as AgentEvent;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentEvent&&(identical(other.turnId, _this.turnId) || other.turnId == _this.turnId)&&(identical(other.seq, _this.seq) || other.seq == _this.seq));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as AgentEvent;
  return Object.hash(runtimeType,_this.turnId,_this.seq);
}

@override
String toString() {
  final _this = this as AgentEvent;
  return 'AgentEvent(turnId: ${_this.turnId}, seq: ${_this.seq})';
}


}

/// @nodoc
abstract mixin class $AgentEventCopyWith<$Res>  {
  factory $AgentEventCopyWith(AgentEvent value, $Res Function(AgentEvent) _then) = _$AgentEventCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq
});




}
/// @nodoc
class _$AgentEventCopyWithImpl<$Res>
    implements $AgentEventCopyWith<$Res> {
  _$AgentEventCopyWithImpl(this._self, this._then);

  final AgentEvent _self;
  final $Res Function(AgentEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? turnId = null,Object? seq = null,}) {
  return _then(_self.copyWith(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [AgentEvent].
extension AgentEventPatterns on AgentEvent {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( AgentStatusEvent value)?  status,TResult Function( AgentTextEvent value)?  text,TResult Function( AgentUiActionEvent value)?  uiAction,TResult Function( AgentCardEvent value)?  card,TResult Function( AgentQuestionEvent value)?  question,TResult Function( AgentUsageEvent value)?  usage,TResult Function( AgentDoneEvent value)?  done,TResult Function( AgentErrorEvent value)?  error,required TResult orElse(),}){
final _that = this;
switch (_that) {
case AgentStatusEvent() when status != null:
return status(_that);case AgentTextEvent() when text != null:
return text(_that);case AgentUiActionEvent() when uiAction != null:
return uiAction(_that);case AgentCardEvent() when card != null:
return card(_that);case AgentQuestionEvent() when question != null:
return question(_that);case AgentUsageEvent() when usage != null:
return usage(_that);case AgentDoneEvent() when done != null:
return done(_that);case AgentErrorEvent() when error != null:
return error(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( AgentStatusEvent value)  status,required TResult Function( AgentTextEvent value)  text,required TResult Function( AgentUiActionEvent value)  uiAction,required TResult Function( AgentCardEvent value)  card,required TResult Function( AgentQuestionEvent value)  question,required TResult Function( AgentUsageEvent value)  usage,required TResult Function( AgentDoneEvent value)  done,required TResult Function( AgentErrorEvent value)  error,}){
final _that = this;
switch (_that) {
case AgentStatusEvent():
return status(_that);case AgentTextEvent():
return text(_that);case AgentUiActionEvent():
return uiAction(_that);case AgentCardEvent():
return card(_that);case AgentQuestionEvent():
return question(_that);case AgentUsageEvent():
return usage(_that);case AgentDoneEvent():
return done(_that);case AgentErrorEvent():
return error(_that);}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( AgentStatusEvent value)?  status,TResult? Function( AgentTextEvent value)?  text,TResult? Function( AgentUiActionEvent value)?  uiAction,TResult? Function( AgentCardEvent value)?  card,TResult? Function( AgentQuestionEvent value)?  question,TResult? Function( AgentUsageEvent value)?  usage,TResult? Function( AgentDoneEvent value)?  done,TResult? Function( AgentErrorEvent value)?  error,}){
final _that = this;
switch (_that) {
case AgentStatusEvent() when status != null:
return status(_that);case AgentTextEvent() when text != null:
return text(_that);case AgentUiActionEvent() when uiAction != null:
return uiAction(_that);case AgentCardEvent() when card != null:
return card(_that);case AgentQuestionEvent() when question != null:
return question(_that);case AgentUsageEvent() when usage != null:
return usage(_that);case AgentDoneEvent() when done != null:
return done(_that);case AgentErrorEvent() when error != null:
return error(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentStepState state, @JsonKey(required: true)  String tool, @JsonKey(required: true)  String text, @JsonKey(includeIfNull: false)  String? detail, @JsonKey(includeIfNull: false)  int? rows, @JsonKey(includeIfNull: false)  String? error, @JsonKey(includeIfNull: false)  int? durationMs,  bool memo)?  status,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String delta)?  text,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  UiActionName action, @JsonKey(required: true)  Map<String, dynamic> args)?  uiAction,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentCard card)?  card,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentQuestion question)?  question,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  CallUsage call, @JsonKey(required: true)  TurnUsage turn)?  usage,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  StopReason stop, @JsonKey(required: true)  TurnUsage usage)?  done,TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String message, @JsonKey(required: true)  bool retryable, @JsonKey(required: true)  TurnUsage usage)?  error,required TResult orElse(),}) {final _that = this;
switch (_that) {
case AgentStatusEvent() when status != null:
return status(_that.turnId,_that.seq,_that.stepId,_that.state,_that.tool,_that.text,_that.detail,_that.rows,_that.error,_that.durationMs,_that.memo);case AgentTextEvent() when text != null:
return text(_that.turnId,_that.seq,_that.delta);case AgentUiActionEvent() when uiAction != null:
return uiAction(_that.turnId,_that.seq,_that.stepId,_that.action,_that.args);case AgentCardEvent() when card != null:
return card(_that.turnId,_that.seq,_that.stepId,_that.card);case AgentQuestionEvent() when question != null:
return question(_that.turnId,_that.seq,_that.stepId,_that.question);case AgentUsageEvent() when usage != null:
return usage(_that.turnId,_that.seq,_that.call,_that.turn);case AgentDoneEvent() when done != null:
return done(_that.turnId,_that.seq,_that.stop,_that.usage);case AgentErrorEvent() when error != null:
return error(_that.turnId,_that.seq,_that.message,_that.retryable,_that.usage);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentStepState state, @JsonKey(required: true)  String tool, @JsonKey(required: true)  String text, @JsonKey(includeIfNull: false)  String? detail, @JsonKey(includeIfNull: false)  int? rows, @JsonKey(includeIfNull: false)  String? error, @JsonKey(includeIfNull: false)  int? durationMs,  bool memo)  status,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String delta)  text,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  UiActionName action, @JsonKey(required: true)  Map<String, dynamic> args)  uiAction,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentCard card)  card,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentQuestion question)  question,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  CallUsage call, @JsonKey(required: true)  TurnUsage turn)  usage,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  StopReason stop, @JsonKey(required: true)  TurnUsage usage)  done,required TResult Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String message, @JsonKey(required: true)  bool retryable, @JsonKey(required: true)  TurnUsage usage)  error,}) {final _that = this;
switch (_that) {
case AgentStatusEvent():
return status(_that.turnId,_that.seq,_that.stepId,_that.state,_that.tool,_that.text,_that.detail,_that.rows,_that.error,_that.durationMs,_that.memo);case AgentTextEvent():
return text(_that.turnId,_that.seq,_that.delta);case AgentUiActionEvent():
return uiAction(_that.turnId,_that.seq,_that.stepId,_that.action,_that.args);case AgentCardEvent():
return card(_that.turnId,_that.seq,_that.stepId,_that.card);case AgentQuestionEvent():
return question(_that.turnId,_that.seq,_that.stepId,_that.question);case AgentUsageEvent():
return usage(_that.turnId,_that.seq,_that.call,_that.turn);case AgentDoneEvent():
return done(_that.turnId,_that.seq,_that.stop,_that.usage);case AgentErrorEvent():
return error(_that.turnId,_that.seq,_that.message,_that.retryable,_that.usage);}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentStepState state, @JsonKey(required: true)  String tool, @JsonKey(required: true)  String text, @JsonKey(includeIfNull: false)  String? detail, @JsonKey(includeIfNull: false)  int? rows, @JsonKey(includeIfNull: false)  String? error, @JsonKey(includeIfNull: false)  int? durationMs,  bool memo)?  status,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String delta)?  text,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  UiActionName action, @JsonKey(required: true)  Map<String, dynamic> args)?  uiAction,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentCard card)?  card,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String stepId, @JsonKey(required: true)  AgentQuestion question)?  question,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  CallUsage call, @JsonKey(required: true)  TurnUsage turn)?  usage,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  StopReason stop, @JsonKey(required: true)  TurnUsage usage)?  done,TResult? Function(@JsonKey(required: true)  String turnId, @JsonKey(required: true)  int seq, @JsonKey(required: true)  String message, @JsonKey(required: true)  bool retryable, @JsonKey(required: true)  TurnUsage usage)?  error,}) {final _that = this;
switch (_that) {
case AgentStatusEvent() when status != null:
return status(_that.turnId,_that.seq,_that.stepId,_that.state,_that.tool,_that.text,_that.detail,_that.rows,_that.error,_that.durationMs,_that.memo);case AgentTextEvent() when text != null:
return text(_that.turnId,_that.seq,_that.delta);case AgentUiActionEvent() when uiAction != null:
return uiAction(_that.turnId,_that.seq,_that.stepId,_that.action,_that.args);case AgentCardEvent() when card != null:
return card(_that.turnId,_that.seq,_that.stepId,_that.card);case AgentQuestionEvent() when question != null:
return question(_that.turnId,_that.seq,_that.stepId,_that.question);case AgentUsageEvent() when usage != null:
return usage(_that.turnId,_that.seq,_that.call,_that.turn);case AgentDoneEvent() when done != null:
return done(_that.turnId,_that.seq,_that.stop,_that.usage);case AgentErrorEvent() when error != null:
return error(_that.turnId,_that.seq,_that.message,_that.retryable,_that.usage);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class AgentStatusEvent implements AgentEvent {
  const AgentStatusEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.stepId, @JsonKey(required: true) required this.state, @JsonKey(required: true) required this.tool, @JsonKey(required: true) required this.text, @JsonKey(includeIfNull: false) this.detail, @JsonKey(includeIfNull: false) this.rows, @JsonKey(includeIfNull: false) this.error, @JsonKey(includeIfNull: false) this.durationMs, this.memo = false,  String? $type}): $type = $type ?? 'status';
  factory AgentStatusEvent.fromJson(Map<String, dynamic> json) => _$AgentStatusEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String stepId;
@JsonKey(required: true) final  AgentStepState state;
@JsonKey(required: true) final  String tool;
@JsonKey(required: true) final  String text;
@JsonKey(includeIfNull: false) final  String? detail;
@JsonKey(includeIfNull: false) final  int? rows;
@JsonKey(includeIfNull: false) final  String? error;
@JsonKey(includeIfNull: false) final  int? durationMs;
@JsonKey() final  bool memo;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentStatusEventCopyWith<AgentStatusEvent> get copyWith => _$AgentStatusEventCopyWithImpl<AgentStatusEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentStatusEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentStatusEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.stepId, stepId) || other.stepId == stepId)&&(identical(other.state, state) || other.state == state)&&(identical(other.tool, tool) || other.tool == tool)&&(identical(other.text, text) || other.text == text)&&(identical(other.detail, detail) || other.detail == detail)&&(identical(other.rows, rows) || other.rows == rows)&&(identical(other.error, error) || other.error == error)&&(identical(other.durationMs, durationMs) || other.durationMs == durationMs)&&(identical(other.memo, memo) || other.memo == memo));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,stepId,state,tool,text,detail,rows,error,durationMs,memo);
}

@override
String toString() {
    return 'AgentEvent.status(turnId: $turnId, seq: $seq, stepId: $stepId, state: $state, tool: $tool, text: $text, detail: $detail, rows: $rows, error: $error, durationMs: $durationMs, memo: $memo)';
}


}

/// @nodoc
abstract mixin class $AgentStatusEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentStatusEventCopyWith(AgentStatusEvent value, $Res Function(AgentStatusEvent) _then) = _$AgentStatusEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String stepId,@JsonKey(required: true) AgentStepState state,@JsonKey(required: true) String tool,@JsonKey(required: true) String text,@JsonKey(includeIfNull: false) String? detail,@JsonKey(includeIfNull: false) int? rows,@JsonKey(includeIfNull: false) String? error,@JsonKey(includeIfNull: false) int? durationMs, bool memo
});




}
/// @nodoc
class _$AgentStatusEventCopyWithImpl<$Res>
    implements $AgentStatusEventCopyWith<$Res> {
  _$AgentStatusEventCopyWithImpl(this._self, this._then);

  final AgentStatusEvent _self;
  final $Res Function(AgentStatusEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? stepId = null,Object? state = null,Object? tool = null,Object? text = null,Object? detail = freezed,Object? rows = freezed,Object? error = freezed,Object? durationMs = freezed,Object? memo = null,}) {
  return _then(AgentStatusEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,stepId: null == stepId ? _self.stepId : stepId // ignore: cast_nullable_to_non_nullable
as String,state: null == state ? _self.state : state // ignore: cast_nullable_to_non_nullable
as AgentStepState,tool: null == tool ? _self.tool : tool // ignore: cast_nullable_to_non_nullable
as String,text: null == text ? _self.text : text // ignore: cast_nullable_to_non_nullable
as String,detail: freezed == detail ? _self.detail : detail // ignore: cast_nullable_to_non_nullable
as String?,rows: freezed == rows ? _self.rows : rows // ignore: cast_nullable_to_non_nullable
as int?,error: freezed == error ? _self.error : error // ignore: cast_nullable_to_non_nullable
as String?,durationMs: freezed == durationMs ? _self.durationMs : durationMs // ignore: cast_nullable_to_non_nullable
as int?,memo: null == memo ? _self.memo : memo // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentTextEvent implements AgentEvent {
  const AgentTextEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.delta,  String? $type}): $type = $type ?? 'text';
  factory AgentTextEvent.fromJson(Map<String, dynamic> json) => _$AgentTextEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String delta;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentTextEventCopyWith<AgentTextEvent> get copyWith => _$AgentTextEventCopyWithImpl<AgentTextEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentTextEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentTextEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.delta, delta) || other.delta == delta));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,delta);
}

@override
String toString() {
    return 'AgentEvent.text(turnId: $turnId, seq: $seq, delta: $delta)';
}


}

/// @nodoc
abstract mixin class $AgentTextEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentTextEventCopyWith(AgentTextEvent value, $Res Function(AgentTextEvent) _then) = _$AgentTextEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String delta
});




}
/// @nodoc
class _$AgentTextEventCopyWithImpl<$Res>
    implements $AgentTextEventCopyWith<$Res> {
  _$AgentTextEventCopyWithImpl(this._self, this._then);

  final AgentTextEvent _self;
  final $Res Function(AgentTextEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? delta = null,}) {
  return _then(AgentTextEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,delta: null == delta ? _self.delta : delta // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentUiActionEvent implements AgentEvent {
  const AgentUiActionEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.stepId, @JsonKey(required: true) required this.action, @JsonKey(required: true) required  Map<String, dynamic> args,  String? $type}): _args = args,$type = $type ?? 'ui_action';
  factory AgentUiActionEvent.fromJson(Map<String, dynamic> json) => _$AgentUiActionEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String stepId;
@JsonKey(required: true) final  UiActionName action;
 final  Map<String, dynamic> _args;
@JsonKey(required: true) Map<String, dynamic> get args {
  if (_args is EqualUnmodifiableMapView) return _args;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableMapView(_args);
}


@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentUiActionEventCopyWith<AgentUiActionEvent> get copyWith => _$AgentUiActionEventCopyWithImpl<AgentUiActionEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentUiActionEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentUiActionEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.stepId, stepId) || other.stepId == stepId)&&(identical(other.action, action) || other.action == action)&&const DeepCollectionEquality().equals(other.args, _args));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,stepId,action,const DeepCollectionEquality().hash(_args));
}

@override
String toString() {
    return 'AgentEvent.uiAction(turnId: $turnId, seq: $seq, stepId: $stepId, action: $action, args: $args)';
}


}

/// @nodoc
abstract mixin class $AgentUiActionEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentUiActionEventCopyWith(AgentUiActionEvent value, $Res Function(AgentUiActionEvent) _then) = _$AgentUiActionEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String stepId,@JsonKey(required: true) UiActionName action,@JsonKey(required: true) Map<String, dynamic> args
});




}
/// @nodoc
class _$AgentUiActionEventCopyWithImpl<$Res>
    implements $AgentUiActionEventCopyWith<$Res> {
  _$AgentUiActionEventCopyWithImpl(this._self, this._then);

  final AgentUiActionEvent _self;
  final $Res Function(AgentUiActionEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? stepId = null,Object? action = null,Object? args = null,}) {
  return _then(AgentUiActionEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,stepId: null == stepId ? _self.stepId : stepId // ignore: cast_nullable_to_non_nullable
as String,action: null == action ? _self.action : action // ignore: cast_nullable_to_non_nullable
as UiActionName,args: null == args ? _self._args : args // ignore: cast_nullable_to_non_nullable
as Map<String, dynamic>,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentCardEvent implements AgentEvent {
  const AgentCardEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.stepId, @JsonKey(required: true) required this.card,  String? $type}): $type = $type ?? 'card';
  factory AgentCardEvent.fromJson(Map<String, dynamic> json) => _$AgentCardEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String stepId;
@JsonKey(required: true) final  AgentCard card;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentCardEventCopyWith<AgentCardEvent> get copyWith => _$AgentCardEventCopyWithImpl<AgentCardEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentCardEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentCardEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.stepId, stepId) || other.stepId == stepId)&&(identical(other.card, card) || other.card == card));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,stepId,card);
}

@override
String toString() {
    return 'AgentEvent.card(turnId: $turnId, seq: $seq, stepId: $stepId, card: $card)';
}


}

/// @nodoc
abstract mixin class $AgentCardEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentCardEventCopyWith(AgentCardEvent value, $Res Function(AgentCardEvent) _then) = _$AgentCardEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String stepId,@JsonKey(required: true) AgentCard card
});




}
/// @nodoc
class _$AgentCardEventCopyWithImpl<$Res>
    implements $AgentCardEventCopyWith<$Res> {
  _$AgentCardEventCopyWithImpl(this._self, this._then);

  final AgentCardEvent _self;
  final $Res Function(AgentCardEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? stepId = null,Object? card = null,}) {
  return _then(AgentCardEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,stepId: null == stepId ? _self.stepId : stepId // ignore: cast_nullable_to_non_nullable
as String,card: null == card ? _self.card : card // ignore: cast_nullable_to_non_nullable
as AgentCard,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentQuestionEvent implements AgentEvent {
  const AgentQuestionEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.stepId, @JsonKey(required: true) required this.question,  String? $type}): $type = $type ?? 'question';
  factory AgentQuestionEvent.fromJson(Map<String, dynamic> json) => _$AgentQuestionEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String stepId;
@JsonKey(required: true) final  AgentQuestion question;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentQuestionEventCopyWith<AgentQuestionEvent> get copyWith => _$AgentQuestionEventCopyWithImpl<AgentQuestionEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentQuestionEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentQuestionEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.stepId, stepId) || other.stepId == stepId)&&(identical(other.question, question) || other.question == question));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,stepId,question);
}

@override
String toString() {
    return 'AgentEvent.question(turnId: $turnId, seq: $seq, stepId: $stepId, question: $question)';
}


}

/// @nodoc
abstract mixin class $AgentQuestionEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentQuestionEventCopyWith(AgentQuestionEvent value, $Res Function(AgentQuestionEvent) _then) = _$AgentQuestionEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String stepId,@JsonKey(required: true) AgentQuestion question
});




}
/// @nodoc
class _$AgentQuestionEventCopyWithImpl<$Res>
    implements $AgentQuestionEventCopyWith<$Res> {
  _$AgentQuestionEventCopyWithImpl(this._self, this._then);

  final AgentQuestionEvent _self;
  final $Res Function(AgentQuestionEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? stepId = null,Object? question = null,}) {
  return _then(AgentQuestionEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,stepId: null == stepId ? _self.stepId : stepId // ignore: cast_nullable_to_non_nullable
as String,question: null == question ? _self.question : question // ignore: cast_nullable_to_non_nullable
as AgentQuestion,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentUsageEvent implements AgentEvent {
  const AgentUsageEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.call, @JsonKey(required: true) required this.turn,  String? $type}): $type = $type ?? 'usage';
  factory AgentUsageEvent.fromJson(Map<String, dynamic> json) => _$AgentUsageEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  CallUsage call;
@JsonKey(required: true) final  TurnUsage turn;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentUsageEventCopyWith<AgentUsageEvent> get copyWith => _$AgentUsageEventCopyWithImpl<AgentUsageEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentUsageEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentUsageEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.call, call) || other.call == call)&&(identical(other.turn, turn) || other.turn == turn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,call,turn);
}

@override
String toString() {
    return 'AgentEvent.usage(turnId: $turnId, seq: $seq, call: $call, turn: $turn)';
}


}

/// @nodoc
abstract mixin class $AgentUsageEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentUsageEventCopyWith(AgentUsageEvent value, $Res Function(AgentUsageEvent) _then) = _$AgentUsageEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) CallUsage call,@JsonKey(required: true) TurnUsage turn
});




}
/// @nodoc
class _$AgentUsageEventCopyWithImpl<$Res>
    implements $AgentUsageEventCopyWith<$Res> {
  _$AgentUsageEventCopyWithImpl(this._self, this._then);

  final AgentUsageEvent _self;
  final $Res Function(AgentUsageEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? call = null,Object? turn = null,}) {
  return _then(AgentUsageEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,call: null == call ? _self.call : call // ignore: cast_nullable_to_non_nullable
as CallUsage,turn: null == turn ? _self.turn : turn // ignore: cast_nullable_to_non_nullable
as TurnUsage,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentDoneEvent implements AgentEvent {
  const AgentDoneEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.stop, @JsonKey(required: true) required this.usage,  String? $type}): $type = $type ?? 'done';
  factory AgentDoneEvent.fromJson(Map<String, dynamic> json) => _$AgentDoneEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  StopReason stop;
@JsonKey(required: true) final  TurnUsage usage;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentDoneEventCopyWith<AgentDoneEvent> get copyWith => _$AgentDoneEventCopyWithImpl<AgentDoneEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentDoneEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentDoneEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.stop, stop) || other.stop == stop)&&(identical(other.usage, usage) || other.usage == usage));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,stop,usage);
}

@override
String toString() {
    return 'AgentEvent.done(turnId: $turnId, seq: $seq, stop: $stop, usage: $usage)';
}


}

/// @nodoc
abstract mixin class $AgentDoneEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentDoneEventCopyWith(AgentDoneEvent value, $Res Function(AgentDoneEvent) _then) = _$AgentDoneEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) StopReason stop,@JsonKey(required: true) TurnUsage usage
});




}
/// @nodoc
class _$AgentDoneEventCopyWithImpl<$Res>
    implements $AgentDoneEventCopyWith<$Res> {
  _$AgentDoneEventCopyWithImpl(this._self, this._then);

  final AgentDoneEvent _self;
  final $Res Function(AgentDoneEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? stop = null,Object? usage = null,}) {
  return _then(AgentDoneEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,stop: null == stop ? _self.stop : stop // ignore: cast_nullable_to_non_nullable
as StopReason,usage: null == usage ? _self.usage : usage // ignore: cast_nullable_to_non_nullable
as TurnUsage,
  ));
}


}

/// @nodoc
@JsonSerializable()

class AgentErrorEvent implements AgentEvent {
  const AgentErrorEvent({@JsonKey(required: true) required this.turnId, @JsonKey(required: true) required this.seq, @JsonKey(required: true) required this.message, @JsonKey(required: true) required this.retryable, @JsonKey(required: true) required this.usage,  String? $type}): $type = $type ?? 'error';
  factory AgentErrorEvent.fromJson(Map<String, dynamic> json) => _$AgentErrorEventFromJson(json);

@override@JsonKey(required: true) final  String turnId;
@override@JsonKey(required: true) final  int seq;
@JsonKey(required: true) final  String message;
@JsonKey(required: true) final  bool retryable;
@JsonKey(required: true) final  TurnUsage usage;

@JsonKey(name: 'event')
final String $type;


/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AgentErrorEventCopyWith<AgentErrorEvent> get copyWith => _$AgentErrorEventCopyWithImpl<AgentErrorEvent>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AgentErrorEventToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AgentErrorEvent&&(identical(other.turnId, turnId) || other.turnId == turnId)&&(identical(other.seq, seq) || other.seq == seq)&&(identical(other.message, message) || other.message == message)&&(identical(other.retryable, retryable) || other.retryable == retryable)&&(identical(other.usage, usage) || other.usage == usage));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,turnId,seq,message,retryable,usage);
}

@override
String toString() {
    return 'AgentEvent.error(turnId: $turnId, seq: $seq, message: $message, retryable: $retryable, usage: $usage)';
}


}

/// @nodoc
abstract mixin class $AgentErrorEventCopyWith<$Res> implements $AgentEventCopyWith<$Res> {
  factory $AgentErrorEventCopyWith(AgentErrorEvent value, $Res Function(AgentErrorEvent) _then) = _$AgentErrorEventCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String turnId,@JsonKey(required: true) int seq,@JsonKey(required: true) String message,@JsonKey(required: true) bool retryable,@JsonKey(required: true) TurnUsage usage
});




}
/// @nodoc
class _$AgentErrorEventCopyWithImpl<$Res>
    implements $AgentErrorEventCopyWith<$Res> {
  _$AgentErrorEventCopyWithImpl(this._self, this._then);

  final AgentErrorEvent _self;
  final $Res Function(AgentErrorEvent) _then;

/// Create a copy of AgentEvent
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? turnId = null,Object? seq = null,Object? message = null,Object? retryable = null,Object? usage = null,}) {
  return _then(AgentErrorEvent(
turnId: null == turnId ? _self.turnId : turnId // ignore: cast_nullable_to_non_nullable
as String,seq: null == seq ? _self.seq : seq // ignore: cast_nullable_to_non_nullable
as int,message: null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,retryable: null == retryable ? _self.retryable : retryable // ignore: cast_nullable_to_non_nullable
as bool,usage: null == usage ? _self.usage : usage // ignore: cast_nullable_to_non_nullable
as TurnUsage,
  ));
}


}

// dart format on
