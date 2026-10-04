// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'map_models.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
GeoJsonGeometry _$GeoJsonGeometryFromJson(
  Map<String, dynamic> json
) {
        switch (json['type']) {
                  case 'Point':
          return GeoJsonPoint.fromJson(
            json
          );
                case 'MultiPoint':
          return GeoJsonMultiPoint.fromJson(
            json
          );
                case 'LineString':
          return GeoJsonLineString.fromJson(
            json
          );
                case 'MultiLineString':
          return GeoJsonMultiLineString.fromJson(
            json
          );
                case 'Polygon':
          return GeoJsonPolygon.fromJson(
            json
          );
                case 'MultiPolygon':
          return GeoJsonMultiPolygon.fromJson(
            json
          );
        
          default:
            throw CheckedFromJsonException(
  json,
  'type',
  'GeoJsonGeometry',
  'Invalid union type "${json['type']}"!'
);
        }
      
}

/// @nodoc
mixin _$GeoJsonGeometry {

@JsonKey(required: true) List<Object> get coordinates;

  /// Serializes this GeoJsonGeometry to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as GeoJsonGeometry;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonGeometry&&const DeepCollectionEquality().equals(other.coordinates, _this.coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as GeoJsonGeometry;
  return Object.hash(runtimeType,const DeepCollectionEquality().hash(_this.coordinates));
}

@override
String toString() {
  final _this = this as GeoJsonGeometry;
  return 'GeoJsonGeometry(coordinates: ${_this.coordinates})';
}


}

/// @nodoc
class $GeoJsonGeometryCopyWith<$Res>  {
$GeoJsonGeometryCopyWith(GeoJsonGeometry _, $Res Function(GeoJsonGeometry) __);
}


/// Adds pattern-matching-related methods to [GeoJsonGeometry].
extension GeoJsonGeometryPatterns on GeoJsonGeometry {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( GeoJsonPoint value)?  point,TResult Function( GeoJsonMultiPoint value)?  multiPoint,TResult Function( GeoJsonLineString value)?  lineString,TResult Function( GeoJsonMultiLineString value)?  multiLineString,TResult Function( GeoJsonPolygon value)?  polygon,TResult Function( GeoJsonMultiPolygon value)?  multiPolygon,required TResult orElse(),}){
final _that = this;
switch (_that) {
case GeoJsonPoint() when point != null:
return point(_that);case GeoJsonMultiPoint() when multiPoint != null:
return multiPoint(_that);case GeoJsonLineString() when lineString != null:
return lineString(_that);case GeoJsonMultiLineString() when multiLineString != null:
return multiLineString(_that);case GeoJsonPolygon() when polygon != null:
return polygon(_that);case GeoJsonMultiPolygon() when multiPolygon != null:
return multiPolygon(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( GeoJsonPoint value)  point,required TResult Function( GeoJsonMultiPoint value)  multiPoint,required TResult Function( GeoJsonLineString value)  lineString,required TResult Function( GeoJsonMultiLineString value)  multiLineString,required TResult Function( GeoJsonPolygon value)  polygon,required TResult Function( GeoJsonMultiPolygon value)  multiPolygon,}){
final _that = this;
switch (_that) {
case GeoJsonPoint():
return point(_that);case GeoJsonMultiPoint():
return multiPoint(_that);case GeoJsonLineString():
return lineString(_that);case GeoJsonMultiLineString():
return multiLineString(_that);case GeoJsonPolygon():
return polygon(_that);case GeoJsonMultiPolygon():
return multiPolygon(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( GeoJsonPoint value)?  point,TResult? Function( GeoJsonMultiPoint value)?  multiPoint,TResult? Function( GeoJsonLineString value)?  lineString,TResult? Function( GeoJsonMultiLineString value)?  multiLineString,TResult? Function( GeoJsonPolygon value)?  polygon,TResult? Function( GeoJsonMultiPolygon value)?  multiPolygon,}){
final _that = this;
switch (_that) {
case GeoJsonPoint() when point != null:
return point(_that);case GeoJsonMultiPoint() when multiPoint != null:
return multiPoint(_that);case GeoJsonLineString() when lineString != null:
return lineString(_that);case GeoJsonMultiLineString() when multiLineString != null:
return multiLineString(_that);case GeoJsonPolygon() when polygon != null:
return polygon(_that);case GeoJsonMultiPolygon() when multiPolygon != null:
return multiPolygon(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function(@JsonKey(required: true)  List<double> coordinates)?  point,TResult Function(@JsonKey(required: true)  List<List<double>> coordinates)?  multiPoint,TResult Function(@JsonKey(required: true)  List<List<double>> coordinates)?  lineString,TResult Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)?  multiLineString,TResult Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)?  polygon,TResult Function(@JsonKey(required: true)  List<List<List<List<double>>>> coordinates)?  multiPolygon,required TResult orElse(),}) {final _that = this;
switch (_that) {
case GeoJsonPoint() when point != null:
return point(_that.coordinates);case GeoJsonMultiPoint() when multiPoint != null:
return multiPoint(_that.coordinates);case GeoJsonLineString() when lineString != null:
return lineString(_that.coordinates);case GeoJsonMultiLineString() when multiLineString != null:
return multiLineString(_that.coordinates);case GeoJsonPolygon() when polygon != null:
return polygon(_that.coordinates);case GeoJsonMultiPolygon() when multiPolygon != null:
return multiPolygon(_that.coordinates);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function(@JsonKey(required: true)  List<double> coordinates)  point,required TResult Function(@JsonKey(required: true)  List<List<double>> coordinates)  multiPoint,required TResult Function(@JsonKey(required: true)  List<List<double>> coordinates)  lineString,required TResult Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)  multiLineString,required TResult Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)  polygon,required TResult Function(@JsonKey(required: true)  List<List<List<List<double>>>> coordinates)  multiPolygon,}) {final _that = this;
switch (_that) {
case GeoJsonPoint():
return point(_that.coordinates);case GeoJsonMultiPoint():
return multiPoint(_that.coordinates);case GeoJsonLineString():
return lineString(_that.coordinates);case GeoJsonMultiLineString():
return multiLineString(_that.coordinates);case GeoJsonPolygon():
return polygon(_that.coordinates);case GeoJsonMultiPolygon():
return multiPolygon(_that.coordinates);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function(@JsonKey(required: true)  List<double> coordinates)?  point,TResult? Function(@JsonKey(required: true)  List<List<double>> coordinates)?  multiPoint,TResult? Function(@JsonKey(required: true)  List<List<double>> coordinates)?  lineString,TResult? Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)?  multiLineString,TResult? Function(@JsonKey(required: true)  List<List<List<double>>> coordinates)?  polygon,TResult? Function(@JsonKey(required: true)  List<List<List<List<double>>>> coordinates)?  multiPolygon,}) {final _that = this;
switch (_that) {
case GeoJsonPoint() when point != null:
return point(_that.coordinates);case GeoJsonMultiPoint() when multiPoint != null:
return multiPoint(_that.coordinates);case GeoJsonLineString() when lineString != null:
return lineString(_that.coordinates);case GeoJsonMultiLineString() when multiLineString != null:
return multiLineString(_that.coordinates);case GeoJsonPolygon() when polygon != null:
return polygon(_that.coordinates);case GeoJsonMultiPolygon() when multiPolygon != null:
return multiPolygon(_that.coordinates);case _:
  return null;

}
}

}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonPoint extends GeoJsonGeometry {
  const GeoJsonPoint({@JsonKey(required: true) required  List<double> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'Point',super._();
  factory GeoJsonPoint.fromJson(Map<String, dynamic> json) => _$GeoJsonPointFromJson(json);

 final  List<double> _coordinates;
@override@JsonKey(required: true) List<double> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonPointCopyWith<GeoJsonPoint> get copyWith => _$GeoJsonPointCopyWithImpl<GeoJsonPoint>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonPointToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonPoint&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.point(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonPointCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonPointCopyWith(GeoJsonPoint value, $Res Function(GeoJsonPoint) _then) = _$GeoJsonPointCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<double> coordinates
});




}
/// @nodoc
class _$GeoJsonPointCopyWithImpl<$Res>
    implements $GeoJsonPointCopyWith<$Res> {
  _$GeoJsonPointCopyWithImpl(this._self, this._then);

  final GeoJsonPoint _self;
  final $Res Function(GeoJsonPoint) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonPoint(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<double>,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonMultiPoint extends GeoJsonGeometry {
  const GeoJsonMultiPoint({@JsonKey(required: true) required  List<List<double>> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'MultiPoint',super._();
  factory GeoJsonMultiPoint.fromJson(Map<String, dynamic> json) => _$GeoJsonMultiPointFromJson(json);

 final  List<List<double>> _coordinates;
@override@JsonKey(required: true) List<List<double>> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonMultiPointCopyWith<GeoJsonMultiPoint> get copyWith => _$GeoJsonMultiPointCopyWithImpl<GeoJsonMultiPoint>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonMultiPointToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonMultiPoint&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.multiPoint(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonMultiPointCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonMultiPointCopyWith(GeoJsonMultiPoint value, $Res Function(GeoJsonMultiPoint) _then) = _$GeoJsonMultiPointCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<List<double>> coordinates
});




}
/// @nodoc
class _$GeoJsonMultiPointCopyWithImpl<$Res>
    implements $GeoJsonMultiPointCopyWith<$Res> {
  _$GeoJsonMultiPointCopyWithImpl(this._self, this._then);

  final GeoJsonMultiPoint _self;
  final $Res Function(GeoJsonMultiPoint) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonMultiPoint(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<List<double>>,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonLineString extends GeoJsonGeometry {
  const GeoJsonLineString({@JsonKey(required: true) required  List<List<double>> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'LineString',super._();
  factory GeoJsonLineString.fromJson(Map<String, dynamic> json) => _$GeoJsonLineStringFromJson(json);

 final  List<List<double>> _coordinates;
@override@JsonKey(required: true) List<List<double>> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonLineStringCopyWith<GeoJsonLineString> get copyWith => _$GeoJsonLineStringCopyWithImpl<GeoJsonLineString>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonLineStringToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonLineString&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.lineString(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonLineStringCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonLineStringCopyWith(GeoJsonLineString value, $Res Function(GeoJsonLineString) _then) = _$GeoJsonLineStringCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<List<double>> coordinates
});




}
/// @nodoc
class _$GeoJsonLineStringCopyWithImpl<$Res>
    implements $GeoJsonLineStringCopyWith<$Res> {
  _$GeoJsonLineStringCopyWithImpl(this._self, this._then);

  final GeoJsonLineString _self;
  final $Res Function(GeoJsonLineString) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonLineString(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<List<double>>,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonMultiLineString extends GeoJsonGeometry {
  const GeoJsonMultiLineString({@JsonKey(required: true) required  List<List<List<double>>> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'MultiLineString',super._();
  factory GeoJsonMultiLineString.fromJson(Map<String, dynamic> json) => _$GeoJsonMultiLineStringFromJson(json);

 final  List<List<List<double>>> _coordinates;
@override@JsonKey(required: true) List<List<List<double>>> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonMultiLineStringCopyWith<GeoJsonMultiLineString> get copyWith => _$GeoJsonMultiLineStringCopyWithImpl<GeoJsonMultiLineString>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonMultiLineStringToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonMultiLineString&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.multiLineString(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonMultiLineStringCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonMultiLineStringCopyWith(GeoJsonMultiLineString value, $Res Function(GeoJsonMultiLineString) _then) = _$GeoJsonMultiLineStringCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<List<List<double>>> coordinates
});




}
/// @nodoc
class _$GeoJsonMultiLineStringCopyWithImpl<$Res>
    implements $GeoJsonMultiLineStringCopyWith<$Res> {
  _$GeoJsonMultiLineStringCopyWithImpl(this._self, this._then);

  final GeoJsonMultiLineString _self;
  final $Res Function(GeoJsonMultiLineString) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonMultiLineString(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<List<List<double>>>,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonPolygon extends GeoJsonGeometry {
  const GeoJsonPolygon({@JsonKey(required: true) required  List<List<List<double>>> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'Polygon',super._();
  factory GeoJsonPolygon.fromJson(Map<String, dynamic> json) => _$GeoJsonPolygonFromJson(json);

 final  List<List<List<double>>> _coordinates;
@override@JsonKey(required: true) List<List<List<double>>> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonPolygonCopyWith<GeoJsonPolygon> get copyWith => _$GeoJsonPolygonCopyWithImpl<GeoJsonPolygon>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonPolygonToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonPolygon&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.polygon(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonPolygonCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonPolygonCopyWith(GeoJsonPolygon value, $Res Function(GeoJsonPolygon) _then) = _$GeoJsonPolygonCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<List<List<double>>> coordinates
});




}
/// @nodoc
class _$GeoJsonPolygonCopyWithImpl<$Res>
    implements $GeoJsonPolygonCopyWith<$Res> {
  _$GeoJsonPolygonCopyWithImpl(this._self, this._then);

  final GeoJsonPolygon _self;
  final $Res Function(GeoJsonPolygon) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonPolygon(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<List<List<double>>>,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class GeoJsonMultiPolygon extends GeoJsonGeometry {
  const GeoJsonMultiPolygon({@JsonKey(required: true) required  List<List<List<List<double>>>> coordinates,  String? $type}): _coordinates = coordinates,$type = $type ?? 'MultiPolygon',super._();
  factory GeoJsonMultiPolygon.fromJson(Map<String, dynamic> json) => _$GeoJsonMultiPolygonFromJson(json);

 final  List<List<List<List<double>>>> _coordinates;
@override@JsonKey(required: true) List<List<List<List<double>>>> get coordinates {
  if (_coordinates is EqualUnmodifiableListView) return _coordinates;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_coordinates);
}


@JsonKey(name: 'type')
final String $type;


/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$GeoJsonMultiPolygonCopyWith<GeoJsonMultiPolygon> get copyWith => _$GeoJsonMultiPolygonCopyWithImpl<GeoJsonMultiPolygon>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$GeoJsonMultiPolygonToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is GeoJsonMultiPolygon&&const DeepCollectionEquality().equals(other.coordinates, _coordinates));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_coordinates));
}

@override
String toString() {
    return 'GeoJsonGeometry.multiPolygon(coordinates: $coordinates)';
}


}

/// @nodoc
abstract mixin class $GeoJsonMultiPolygonCopyWith<$Res> implements $GeoJsonGeometryCopyWith<$Res> {
  factory $GeoJsonMultiPolygonCopyWith(GeoJsonMultiPolygon value, $Res Function(GeoJsonMultiPolygon) _then) = _$GeoJsonMultiPolygonCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<List<List<List<double>>>> coordinates
});




}
/// @nodoc
class _$GeoJsonMultiPolygonCopyWithImpl<$Res>
    implements $GeoJsonMultiPolygonCopyWith<$Res> {
  _$GeoJsonMultiPolygonCopyWithImpl(this._self, this._then);

  final GeoJsonMultiPolygon _self;
  final $Res Function(GeoJsonMultiPolygon) _then;

/// Create a copy of GeoJsonGeometry
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? coordinates = null,}) {
  return _then(GeoJsonMultiPolygon(
coordinates: null == coordinates ? _self._coordinates : coordinates // ignore: cast_nullable_to_non_nullable
as List<List<List<List<double>>>>,
  ));
}


}

PageScope _$PageScopeFromJson(
  Map<String, dynamic> json
) {
        switch (json['kind']) {
                  case 'unlocated':
          return UnlocatedPageScope.fromJson(
            json
          );
                case 'aggregateMembers':
          return AggregateMembersPageScope.fromJson(
            json
          );
        
          default:
            throw CheckedFromJsonException(
  json,
  'kind',
  'PageScope',
  'Invalid union type "${json['kind']}"!'
);
        }
      
}

/// @nodoc
mixin _$PageScope {



  /// Serializes this PageScope to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is PageScope);
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode => runtimeType.hashCode;

@override
String toString() {
    return 'PageScope()';
}


}

/// @nodoc
class $PageScopeCopyWith<$Res>  {
$PageScopeCopyWith(PageScope _, $Res Function(PageScope) __);
}


/// Adds pattern-matching-related methods to [PageScope].
extension PageScopePatterns on PageScope {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( UnlocatedPageScope value)?  unlocated,TResult Function( AggregateMembersPageScope value)?  aggregateMembers,required TResult orElse(),}){
final _that = this;
switch (_that) {
case UnlocatedPageScope() when unlocated != null:
return unlocated(_that);case AggregateMembersPageScope() when aggregateMembers != null:
return aggregateMembers(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( UnlocatedPageScope value)  unlocated,required TResult Function( AggregateMembersPageScope value)  aggregateMembers,}){
final _that = this;
switch (_that) {
case UnlocatedPageScope():
return unlocated(_that);case AggregateMembersPageScope():
return aggregateMembers(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( UnlocatedPageScope value)?  unlocated,TResult? Function( AggregateMembersPageScope value)?  aggregateMembers,}){
final _that = this;
switch (_that) {
case UnlocatedPageScope() when unlocated != null:
return unlocated(_that);case AggregateMembersPageScope() when aggregateMembers != null:
return aggregateMembers(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function(@JsonKey(required: true)  List<String> areaRefs, @JsonKey(required: true)  String? sourceJurisdiction)?  unlocated,TResult Function(@JsonKey(required: true)  String aggregateId, @JsonKey(required: true)@MapBoundsConverter()  MapBounds bounds, @JsonKey(required: true)  TimeWindow? window, @JsonKey(required: true)  String unit)?  aggregateMembers,required TResult orElse(),}) {final _that = this;
switch (_that) {
case UnlocatedPageScope() when unlocated != null:
return unlocated(_that.areaRefs,_that.sourceJurisdiction);case AggregateMembersPageScope() when aggregateMembers != null:
return aggregateMembers(_that.aggregateId,_that.bounds,_that.window,_that.unit);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function(@JsonKey(required: true)  List<String> areaRefs, @JsonKey(required: true)  String? sourceJurisdiction)  unlocated,required TResult Function(@JsonKey(required: true)  String aggregateId, @JsonKey(required: true)@MapBoundsConverter()  MapBounds bounds, @JsonKey(required: true)  TimeWindow? window, @JsonKey(required: true)  String unit)  aggregateMembers,}) {final _that = this;
switch (_that) {
case UnlocatedPageScope():
return unlocated(_that.areaRefs,_that.sourceJurisdiction);case AggregateMembersPageScope():
return aggregateMembers(_that.aggregateId,_that.bounds,_that.window,_that.unit);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function(@JsonKey(required: true)  List<String> areaRefs, @JsonKey(required: true)  String? sourceJurisdiction)?  unlocated,TResult? Function(@JsonKey(required: true)  String aggregateId, @JsonKey(required: true)@MapBoundsConverter()  MapBounds bounds, @JsonKey(required: true)  TimeWindow? window, @JsonKey(required: true)  String unit)?  aggregateMembers,}) {final _that = this;
switch (_that) {
case UnlocatedPageScope() when unlocated != null:
return unlocated(_that.areaRefs,_that.sourceJurisdiction);case AggregateMembersPageScope() when aggregateMembers != null:
return aggregateMembers(_that.aggregateId,_that.bounds,_that.window,_that.unit);case _:
  return null;

}
}

}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class UnlocatedPageScope extends PageScope {
  const UnlocatedPageScope({@JsonKey(required: true) required  List<String> areaRefs, @JsonKey(required: true) required this.sourceJurisdiction,  String? $type}): _areaRefs = areaRefs,$type = $type ?? 'unlocated',super._();
  factory UnlocatedPageScope.fromJson(Map<String, dynamic> json) => _$UnlocatedPageScopeFromJson(json);

 final  List<String> _areaRefs;
@JsonKey(required: true) List<String> get areaRefs {
  if (_areaRefs is EqualUnmodifiableListView) return _areaRefs;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_areaRefs);
}

@JsonKey(required: true) final  String? sourceJurisdiction;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of PageScope
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UnlocatedPageScopeCopyWith<UnlocatedPageScope> get copyWith => _$UnlocatedPageScopeCopyWithImpl<UnlocatedPageScope>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$UnlocatedPageScopeToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is UnlocatedPageScope&&const DeepCollectionEquality().equals(other.areaRefs, _areaRefs)&&(identical(other.sourceJurisdiction, sourceJurisdiction) || other.sourceJurisdiction == sourceJurisdiction));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_areaRefs),sourceJurisdiction);
}

@override
String toString() {
    return 'PageScope.unlocated(areaRefs: $areaRefs, sourceJurisdiction: $sourceJurisdiction)';
}


}

/// @nodoc
abstract mixin class $UnlocatedPageScopeCopyWith<$Res> implements $PageScopeCopyWith<$Res> {
  factory $UnlocatedPageScopeCopyWith(UnlocatedPageScope value, $Res Function(UnlocatedPageScope) _then) = _$UnlocatedPageScopeCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) List<String> areaRefs,@JsonKey(required: true) String? sourceJurisdiction
});




}
/// @nodoc
class _$UnlocatedPageScopeCopyWithImpl<$Res>
    implements $UnlocatedPageScopeCopyWith<$Res> {
  _$UnlocatedPageScopeCopyWithImpl(this._self, this._then);

  final UnlocatedPageScope _self;
  final $Res Function(UnlocatedPageScope) _then;

/// Create a copy of PageScope
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? areaRefs = null,Object? sourceJurisdiction = freezed,}) {
  return _then(UnlocatedPageScope(
areaRefs: null == areaRefs ? _self._areaRefs : areaRefs // ignore: cast_nullable_to_non_nullable
as List<String>,sourceJurisdiction: freezed == sourceJurisdiction ? _self.sourceJurisdiction : sourceJurisdiction // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class AggregateMembersPageScope extends PageScope {
  const AggregateMembersPageScope({@JsonKey(required: true) required this.aggregateId, @JsonKey(required: true)@MapBoundsConverter() required this.bounds, @JsonKey(required: true) required this.window, @JsonKey(required: true) required this.unit,  String? $type}): $type = $type ?? 'aggregateMembers',super._();
  factory AggregateMembersPageScope.fromJson(Map<String, dynamic> json) => _$AggregateMembersPageScopeFromJson(json);

@JsonKey(required: true) final  String aggregateId;
@JsonKey(required: true)@MapBoundsConverter() final  MapBounds bounds;
@JsonKey(required: true) final  TimeWindow? window;
@JsonKey(required: true) final  String unit;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of PageScope
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AggregateMembersPageScopeCopyWith<AggregateMembersPageScope> get copyWith => _$AggregateMembersPageScopeCopyWithImpl<AggregateMembersPageScope>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AggregateMembersPageScopeToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AggregateMembersPageScope&&(identical(other.aggregateId, aggregateId) || other.aggregateId == aggregateId)&&(identical(other.bounds, bounds) || other.bounds == bounds)&&(identical(other.window, window) || other.window == window)&&(identical(other.unit, unit) || other.unit == unit));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,aggregateId,bounds,window,unit);
}

@override
String toString() {
    return 'PageScope.aggregateMembers(aggregateId: $aggregateId, bounds: $bounds, window: $window, unit: $unit)';
}


}

/// @nodoc
abstract mixin class $AggregateMembersPageScopeCopyWith<$Res> implements $PageScopeCopyWith<$Res> {
  factory $AggregateMembersPageScopeCopyWith(AggregateMembersPageScope value, $Res Function(AggregateMembersPageScope) _then) = _$AggregateMembersPageScopeCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String aggregateId,@JsonKey(required: true)@MapBoundsConverter() MapBounds bounds,@JsonKey(required: true) TimeWindow? window,@JsonKey(required: true) String unit
});




}
/// @nodoc
class _$AggregateMembersPageScopeCopyWithImpl<$Res>
    implements $AggregateMembersPageScopeCopyWith<$Res> {
  _$AggregateMembersPageScopeCopyWithImpl(this._self, this._then);

  final AggregateMembersPageScope _self;
  final $Res Function(AggregateMembersPageScope) _then;

/// Create a copy of PageScope
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') $Res call({Object? aggregateId = null,Object? bounds = null,Object? window = freezed,Object? unit = null,}) {
  return _then(AggregateMembersPageScope(
aggregateId: null == aggregateId ? _self.aggregateId : aggregateId // ignore: cast_nullable_to_non_nullable
as String,bounds: null == bounds ? _self.bounds : bounds // ignore: cast_nullable_to_non_nullable
as MapBounds,window: freezed == window ? _self.window : window // ignore: cast_nullable_to_non_nullable
as TimeWindow?,unit: null == unit ? _self.unit : unit // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

MapItem _$MapItemFromJson(
  Map<String, dynamic> json
) {
        switch (json['kind']) {
                  case 'pedestrian':
          return PedestrianMapItem.fromJson(
            json
          );
                case 'anomaly':
          return AnomalyMapItem.fromJson(
            json
          );
                case 'disruption':
          return DisruptionMapItem.fromJson(
            json
          );
                case 'event':
          return EventMapItem.fromJson(
            json
          );
                case 'planning':
          return PlanningMapItem.fromJson(
            json
          );
                case 'boundary':
          return BoundaryMapItem.fromJson(
            json
          );
                case 'news':
          return NewsMapItem.fromJson(
            json
          );
                case 'areaIndicator':
          return AreaIndicatorMapItem.fromJson(
            json
          );
                case 'aggregate':
          return AggregateMapItem.fromJson(
            json
          );
        
          default:
            throw CheckedFromJsonException(
  json,
  'kind',
  'MapItem',
  'Invalid union type "${json['kind']}"!'
);
        }
      
}

/// @nodoc
mixin _$MapItem {

@JsonKey(required: true) String get id;@JsonKey(required: true) String get versionId;@JsonKey(required: true) MapLayerId get layerId;@JsonKey(required: true) String get title;@JsonKey(required: true) GeoJsonGeometry? get geometry;@JsonKey(required: true) MapLocation get location;@JsonKey(required: true) MapAssertionKind get assertionKind;@JsonKey(required: true) MapLifecycle get lifecycle;@JsonKey(required: true) MapItemTime get time;@JsonKey(required: true) List<MapSource> get sources;@JsonKey(required: true) MapItemDetails get details;@JsonKey(includeIfNull: false) GeometryPresentation? get geometryPresentation;
/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$MapItemCopyWith<MapItem> get copyWith => _$MapItemCopyWithImpl<MapItem>(this as MapItem, _$identity);

  /// Serializes this MapItem to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as MapItem;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is MapItem&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.versionId, _this.versionId) || other.versionId == _this.versionId)&&(identical(other.layerId, _this.layerId) || other.layerId == _this.layerId)&&(identical(other.title, _this.title) || other.title == _this.title)&&(identical(other.geometry, _this.geometry) || other.geometry == _this.geometry)&&(identical(other.location, _this.location) || other.location == _this.location)&&(identical(other.assertionKind, _this.assertionKind) || other.assertionKind == _this.assertionKind)&&(identical(other.lifecycle, _this.lifecycle) || other.lifecycle == _this.lifecycle)&&(identical(other.time, _this.time) || other.time == _this.time)&&const DeepCollectionEquality().equals(other.sources, _this.sources)&&(identical(other.details, _this.details) || other.details == _this.details)&&(identical(other.geometryPresentation, _this.geometryPresentation) || other.geometryPresentation == _this.geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as MapItem;
  return Object.hash(runtimeType,_this.id,_this.versionId,_this.layerId,_this.title,_this.geometry,_this.location,_this.assertionKind,_this.lifecycle,_this.time,const DeepCollectionEquality().hash(_this.sources),_this.details,_this.geometryPresentation);
}

@override
String toString() {
  final _this = this as MapItem;
  return 'MapItem(id: ${_this.id}, versionId: ${_this.versionId}, layerId: ${_this.layerId}, title: ${_this.title}, geometry: ${_this.geometry}, location: ${_this.location}, assertionKind: ${_this.assertionKind}, lifecycle: ${_this.lifecycle}, time: ${_this.time}, sources: ${_this.sources}, details: ${_this.details}, geometryPresentation: ${_this.geometryPresentation})';
}


}

/// @nodoc
abstract mixin class $MapItemCopyWith<$Res>  {
  factory $MapItemCopyWith(MapItem value, $Res Function(MapItem) _then) = _$MapItemCopyWithImpl;
@useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


$GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$MapItemCopyWithImpl<$Res>
    implements $MapItemCopyWith<$Res> {
  _$MapItemCopyWithImpl(this._self, this._then);

  final MapItem _self;
  final $Res Function(MapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? geometryPresentation = freezed,}) {
  return _then(_self.copyWith(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self.sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}
/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}


/// Adds pattern-matching-related methods to [MapItem].
extension MapItemPatterns on MapItem {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( PedestrianMapItem value)?  pedestrian,TResult Function( AnomalyMapItem value)?  anomaly,TResult Function( DisruptionMapItem value)?  disruption,TResult Function( EventMapItem value)?  event,TResult Function( PlanningMapItem value)?  planning,TResult Function( BoundaryMapItem value)?  boundary,TResult Function( NewsMapItem value)?  news,TResult Function( AreaIndicatorMapItem value)?  areaIndicator,TResult Function( AggregateMapItem value)?  aggregate,required TResult orElse(),}){
final _that = this;
switch (_that) {
case PedestrianMapItem() when pedestrian != null:
return pedestrian(_that);case AnomalyMapItem() when anomaly != null:
return anomaly(_that);case DisruptionMapItem() when disruption != null:
return disruption(_that);case EventMapItem() when event != null:
return event(_that);case PlanningMapItem() when planning != null:
return planning(_that);case BoundaryMapItem() when boundary != null:
return boundary(_that);case NewsMapItem() when news != null:
return news(_that);case AreaIndicatorMapItem() when areaIndicator != null:
return areaIndicator(_that);case AggregateMapItem() when aggregate != null:
return aggregate(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( PedestrianMapItem value)  pedestrian,required TResult Function( AnomalyMapItem value)  anomaly,required TResult Function( DisruptionMapItem value)  disruption,required TResult Function( EventMapItem value)  event,required TResult Function( PlanningMapItem value)  planning,required TResult Function( BoundaryMapItem value)  boundary,required TResult Function( NewsMapItem value)  news,required TResult Function( AreaIndicatorMapItem value)  areaIndicator,required TResult Function( AggregateMapItem value)  aggregate,}){
final _that = this;
switch (_that) {
case PedestrianMapItem():
return pedestrian(_that);case AnomalyMapItem():
return anomaly(_that);case DisruptionMapItem():
return disruption(_that);case EventMapItem():
return event(_that);case PlanningMapItem():
return planning(_that);case BoundaryMapItem():
return boundary(_that);case NewsMapItem():
return news(_that);case AreaIndicatorMapItem():
return areaIndicator(_that);case AggregateMapItem():
return aggregate(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( PedestrianMapItem value)?  pedestrian,TResult? Function( AnomalyMapItem value)?  anomaly,TResult? Function( DisruptionMapItem value)?  disruption,TResult? Function( EventMapItem value)?  event,TResult? Function( PlanningMapItem value)?  planning,TResult? Function( BoundaryMapItem value)?  boundary,TResult? Function( NewsMapItem value)?  news,TResult? Function( AreaIndicatorMapItem value)?  areaIndicator,TResult? Function( AggregateMapItem value)?  aggregate,}){
final _that = this;
switch (_that) {
case PedestrianMapItem() when pedestrian != null:
return pedestrian(_that);case AnomalyMapItem() when anomaly != null:
return anomaly(_that);case DisruptionMapItem() when disruption != null:
return disruption(_that);case EventMapItem() when event != null:
return event(_that);case PlanningMapItem() when planning != null:
return planning(_that);case BoundaryMapItem() when boundary != null:
return boundary(_that);case NewsMapItem() when news != null:
return news(_that);case AreaIndicatorMapItem() when areaIndicator != null:
return areaIndicator(_that);case AggregateMapItem() when aggregate != null:
return aggregate(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PedestrianDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  pedestrian,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AnomalyDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  anomaly,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  DisruptionDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  disruption,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  EventDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  event,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PlanningDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  planning,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  BoundaryDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  boundary,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  NewsDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  news,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AreaIndicatorDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  areaIndicator,TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AggregateDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  aggregate,required TResult orElse(),}) {final _that = this;
switch (_that) {
case PedestrianMapItem() when pedestrian != null:
return pedestrian(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AnomalyMapItem() when anomaly != null:
return anomaly(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case DisruptionMapItem() when disruption != null:
return disruption(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case EventMapItem() when event != null:
return event(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case PlanningMapItem() when planning != null:
return planning(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case BoundaryMapItem() when boundary != null:
return boundary(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case NewsMapItem() when news != null:
return news(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AreaIndicatorMapItem() when areaIndicator != null:
return areaIndicator(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AggregateMapItem() when aggregate != null:
return aggregate(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PedestrianDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  pedestrian,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AnomalyDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  anomaly,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  DisruptionDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  disruption,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  EventDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  event,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PlanningDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  planning,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  BoundaryDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  boundary,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  NewsDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  news,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AreaIndicatorDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  areaIndicator,required TResult Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AggregateDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)  aggregate,}) {final _that = this;
switch (_that) {
case PedestrianMapItem():
return pedestrian(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AnomalyMapItem():
return anomaly(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case DisruptionMapItem():
return disruption(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case EventMapItem():
return event(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case PlanningMapItem():
return planning(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case BoundaryMapItem():
return boundary(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case NewsMapItem():
return news(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AreaIndicatorMapItem():
return areaIndicator(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AggregateMapItem():
return aggregate(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PedestrianDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  pedestrian,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AnomalyDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  anomaly,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  DisruptionDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  disruption,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  EventDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  event,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  PlanningDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  planning,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  BoundaryDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  boundary,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  NewsDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  news,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AreaIndicatorDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  areaIndicator,TResult? Function(@JsonKey(required: true)  String id, @JsonKey(required: true)  String versionId, @JsonKey(required: true)  MapLayerId layerId, @JsonKey(required: true)  String title, @JsonKey(required: true)  GeoJsonGeometry? geometry, @JsonKey(required: true)  MapLocation location, @JsonKey(required: true)  MapAssertionKind assertionKind, @JsonKey(required: true)  MapLifecycle lifecycle, @JsonKey(required: true)  MapItemTime time, @JsonKey(required: true)  List<MapSource> sources, @JsonKey(required: true)  AggregateDetails details, @JsonKey(includeIfNull: false)  GeometryPresentation? geometryPresentation)?  aggregate,}) {final _that = this;
switch (_that) {
case PedestrianMapItem() when pedestrian != null:
return pedestrian(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AnomalyMapItem() when anomaly != null:
return anomaly(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case DisruptionMapItem() when disruption != null:
return disruption(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case EventMapItem() when event != null:
return event(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case PlanningMapItem() when planning != null:
return planning(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case BoundaryMapItem() when boundary != null:
return boundary(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case NewsMapItem() when news != null:
return news(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AreaIndicatorMapItem() when areaIndicator != null:
return areaIndicator(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case AggregateMapItem() when aggregate != null:
return aggregate(_that.id,_that.versionId,_that.layerId,_that.title,_that.geometry,_that.location,_that.assertionKind,_that.lifecycle,_that.time,_that.sources,_that.details,_that.geometryPresentation);case _:
  return null;

}
}

}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class PedestrianMapItem extends MapItem {
  const PedestrianMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'pedestrian',super._();
  factory PedestrianMapItem.fromJson(Map<String, dynamic> json) => _$PedestrianMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  PedestrianDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PedestrianMapItemCopyWith<PedestrianMapItem> get copyWith => _$PedestrianMapItemCopyWithImpl<PedestrianMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PedestrianMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is PedestrianMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.pedestrian(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $PedestrianMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $PedestrianMapItemCopyWith(PedestrianMapItem value, $Res Function(PedestrianMapItem) _then) = _$PedestrianMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) PedestrianDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$PedestrianMapItemCopyWithImpl<$Res>
    implements $PedestrianMapItemCopyWith<$Res> {
  _$PedestrianMapItemCopyWithImpl(this._self, this._then);

  final PedestrianMapItem _self;
  final $Res Function(PedestrianMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(PedestrianMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as PedestrianDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class AnomalyMapItem extends MapItem {
  const AnomalyMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'anomaly',super._();
  factory AnomalyMapItem.fromJson(Map<String, dynamic> json) => _$AnomalyMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  AnomalyDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AnomalyMapItemCopyWith<AnomalyMapItem> get copyWith => _$AnomalyMapItemCopyWithImpl<AnomalyMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AnomalyMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AnomalyMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.anomaly(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $AnomalyMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $AnomalyMapItemCopyWith(AnomalyMapItem value, $Res Function(AnomalyMapItem) _then) = _$AnomalyMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) AnomalyDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$AnomalyMapItemCopyWithImpl<$Res>
    implements $AnomalyMapItemCopyWith<$Res> {
  _$AnomalyMapItemCopyWithImpl(this._self, this._then);

  final AnomalyMapItem _self;
  final $Res Function(AnomalyMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(AnomalyMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as AnomalyDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class DisruptionMapItem extends MapItem {
  const DisruptionMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'disruption',super._();
  factory DisruptionMapItem.fromJson(Map<String, dynamic> json) => _$DisruptionMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  DisruptionDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$DisruptionMapItemCopyWith<DisruptionMapItem> get copyWith => _$DisruptionMapItemCopyWithImpl<DisruptionMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$DisruptionMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is DisruptionMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.disruption(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $DisruptionMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $DisruptionMapItemCopyWith(DisruptionMapItem value, $Res Function(DisruptionMapItem) _then) = _$DisruptionMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) DisruptionDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$DisruptionMapItemCopyWithImpl<$Res>
    implements $DisruptionMapItemCopyWith<$Res> {
  _$DisruptionMapItemCopyWithImpl(this._self, this._then);

  final DisruptionMapItem _self;
  final $Res Function(DisruptionMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(DisruptionMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as DisruptionDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class EventMapItem extends MapItem {
  const EventMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'event',super._();
  factory EventMapItem.fromJson(Map<String, dynamic> json) => _$EventMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  EventDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$EventMapItemCopyWith<EventMapItem> get copyWith => _$EventMapItemCopyWithImpl<EventMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$EventMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is EventMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.event(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $EventMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $EventMapItemCopyWith(EventMapItem value, $Res Function(EventMapItem) _then) = _$EventMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) EventDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$EventMapItemCopyWithImpl<$Res>
    implements $EventMapItemCopyWith<$Res> {
  _$EventMapItemCopyWithImpl(this._self, this._then);

  final EventMapItem _self;
  final $Res Function(EventMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(EventMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as EventDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class PlanningMapItem extends MapItem {
  const PlanningMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'planning',super._();
  factory PlanningMapItem.fromJson(Map<String, dynamic> json) => _$PlanningMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  PlanningDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PlanningMapItemCopyWith<PlanningMapItem> get copyWith => _$PlanningMapItemCopyWithImpl<PlanningMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PlanningMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is PlanningMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.planning(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $PlanningMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $PlanningMapItemCopyWith(PlanningMapItem value, $Res Function(PlanningMapItem) _then) = _$PlanningMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) PlanningDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$PlanningMapItemCopyWithImpl<$Res>
    implements $PlanningMapItemCopyWith<$Res> {
  _$PlanningMapItemCopyWithImpl(this._self, this._then);

  final PlanningMapItem _self;
  final $Res Function(PlanningMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(PlanningMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as PlanningDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class BoundaryMapItem extends MapItem {
  const BoundaryMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'boundary',super._();
  factory BoundaryMapItem.fromJson(Map<String, dynamic> json) => _$BoundaryMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  BoundaryDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BoundaryMapItemCopyWith<BoundaryMapItem> get copyWith => _$BoundaryMapItemCopyWithImpl<BoundaryMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BoundaryMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is BoundaryMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.boundary(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $BoundaryMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $BoundaryMapItemCopyWith(BoundaryMapItem value, $Res Function(BoundaryMapItem) _then) = _$BoundaryMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) BoundaryDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$BoundaryMapItemCopyWithImpl<$Res>
    implements $BoundaryMapItemCopyWith<$Res> {
  _$BoundaryMapItemCopyWithImpl(this._self, this._then);

  final BoundaryMapItem _self;
  final $Res Function(BoundaryMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(BoundaryMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as BoundaryDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class NewsMapItem extends MapItem {
  const NewsMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'news',super._();
  factory NewsMapItem.fromJson(Map<String, dynamic> json) => _$NewsMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  NewsDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$NewsMapItemCopyWith<NewsMapItem> get copyWith => _$NewsMapItemCopyWithImpl<NewsMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$NewsMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is NewsMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.news(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $NewsMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $NewsMapItemCopyWith(NewsMapItem value, $Res Function(NewsMapItem) _then) = _$NewsMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) NewsDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$NewsMapItemCopyWithImpl<$Res>
    implements $NewsMapItemCopyWith<$Res> {
  _$NewsMapItemCopyWithImpl(this._self, this._then);

  final NewsMapItem _self;
  final $Res Function(NewsMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(NewsMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as NewsDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class AreaIndicatorMapItem extends MapItem {
  const AreaIndicatorMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'areaIndicator',super._();
  factory AreaIndicatorMapItem.fromJson(Map<String, dynamic> json) => _$AreaIndicatorMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  AreaIndicatorDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AreaIndicatorMapItemCopyWith<AreaIndicatorMapItem> get copyWith => _$AreaIndicatorMapItemCopyWithImpl<AreaIndicatorMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AreaIndicatorMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AreaIndicatorMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.areaIndicator(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $AreaIndicatorMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $AreaIndicatorMapItemCopyWith(AreaIndicatorMapItem value, $Res Function(AreaIndicatorMapItem) _then) = _$AreaIndicatorMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) AreaIndicatorDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$AreaIndicatorMapItemCopyWithImpl<$Res>
    implements $AreaIndicatorMapItemCopyWith<$Res> {
  _$AreaIndicatorMapItemCopyWithImpl(this._self, this._then);

  final AreaIndicatorMapItem _self;
  final $Res Function(AreaIndicatorMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(AreaIndicatorMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as AreaIndicatorDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

/// @nodoc

@JsonSerializable(checked: true, explicitToJson: true)
class AggregateMapItem extends MapItem {
  const AggregateMapItem({@JsonKey(required: true) required this.id, @JsonKey(required: true) required this.versionId, @JsonKey(required: true) required this.layerId, @JsonKey(required: true) required this.title, @JsonKey(required: true) required this.geometry, @JsonKey(required: true) required this.location, @JsonKey(required: true) required this.assertionKind, @JsonKey(required: true) required this.lifecycle, @JsonKey(required: true) required this.time, @JsonKey(required: true) required  List<MapSource> sources, @JsonKey(required: true) required this.details, @JsonKey(includeIfNull: false) this.geometryPresentation,  String? $type}): _sources = sources,$type = $type ?? 'aggregate',super._();
  factory AggregateMapItem.fromJson(Map<String, dynamic> json) => _$AggregateMapItemFromJson(json);

@override@JsonKey(required: true) final  String id;
@override@JsonKey(required: true) final  String versionId;
@override@JsonKey(required: true) final  MapLayerId layerId;
@override@JsonKey(required: true) final  String title;
@override@JsonKey(required: true) final  GeoJsonGeometry? geometry;
@override@JsonKey(required: true) final  MapLocation location;
@override@JsonKey(required: true) final  MapAssertionKind assertionKind;
@override@JsonKey(required: true) final  MapLifecycle lifecycle;
@override@JsonKey(required: true) final  MapItemTime time;
 final  List<MapSource> _sources;
@override@JsonKey(required: true) List<MapSource> get sources {
  if (_sources is EqualUnmodifiableListView) return _sources;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_sources);
}

@override@JsonKey(required: true) final  AggregateDetails details;
@override@JsonKey(includeIfNull: false) final  GeometryPresentation? geometryPresentation;

@JsonKey(name: 'kind')
final String $type;


/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AggregateMapItemCopyWith<AggregateMapItem> get copyWith => _$AggregateMapItemCopyWithImpl<AggregateMapItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AggregateMapItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is AggregateMapItem&&(identical(other.id, id) || other.id == id)&&(identical(other.versionId, versionId) || other.versionId == versionId)&&(identical(other.layerId, layerId) || other.layerId == layerId)&&(identical(other.title, title) || other.title == title)&&(identical(other.geometry, geometry) || other.geometry == geometry)&&(identical(other.location, location) || other.location == location)&&(identical(other.assertionKind, assertionKind) || other.assertionKind == assertionKind)&&(identical(other.lifecycle, lifecycle) || other.lifecycle == lifecycle)&&(identical(other.time, time) || other.time == time)&&const DeepCollectionEquality().equals(other.sources, _sources)&&(identical(other.details, details) || other.details == details)&&(identical(other.geometryPresentation, geometryPresentation) || other.geometryPresentation == geometryPresentation));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,versionId,layerId,title,geometry,location,assertionKind,lifecycle,time,const DeepCollectionEquality().hash(_sources),details,geometryPresentation);
}

@override
String toString() {
    return 'MapItem.aggregate(id: $id, versionId: $versionId, layerId: $layerId, title: $title, geometry: $geometry, location: $location, assertionKind: $assertionKind, lifecycle: $lifecycle, time: $time, sources: $sources, details: $details, geometryPresentation: $geometryPresentation)';
}


}

/// @nodoc
abstract mixin class $AggregateMapItemCopyWith<$Res> implements $MapItemCopyWith<$Res> {
  factory $AggregateMapItemCopyWith(AggregateMapItem value, $Res Function(AggregateMapItem) _then) = _$AggregateMapItemCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(required: true) String id,@JsonKey(required: true) String versionId,@JsonKey(required: true) MapLayerId layerId,@JsonKey(required: true) String title,@JsonKey(required: true) GeoJsonGeometry? geometry,@JsonKey(required: true) MapLocation location,@JsonKey(required: true) MapAssertionKind assertionKind,@JsonKey(required: true) MapLifecycle lifecycle,@JsonKey(required: true) MapItemTime time,@JsonKey(required: true) List<MapSource> sources,@JsonKey(required: true) AggregateDetails details,@JsonKey(includeIfNull: false) GeometryPresentation? geometryPresentation
});


@override $GeoJsonGeometryCopyWith<$Res>? get geometry;

}
/// @nodoc
class _$AggregateMapItemCopyWithImpl<$Res>
    implements $AggregateMapItemCopyWith<$Res> {
  _$AggregateMapItemCopyWithImpl(this._self, this._then);

  final AggregateMapItem _self;
  final $Res Function(AggregateMapItem) _then;

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? versionId = null,Object? layerId = null,Object? title = null,Object? geometry = freezed,Object? location = null,Object? assertionKind = null,Object? lifecycle = null,Object? time = null,Object? sources = null,Object? details = null,Object? geometryPresentation = freezed,}) {
  return _then(AggregateMapItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,versionId: null == versionId ? _self.versionId : versionId // ignore: cast_nullable_to_non_nullable
as String,layerId: null == layerId ? _self.layerId : layerId // ignore: cast_nullable_to_non_nullable
as MapLayerId,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,geometry: freezed == geometry ? _self.geometry : geometry // ignore: cast_nullable_to_non_nullable
as GeoJsonGeometry?,location: null == location ? _self.location : location // ignore: cast_nullable_to_non_nullable
as MapLocation,assertionKind: null == assertionKind ? _self.assertionKind : assertionKind // ignore: cast_nullable_to_non_nullable
as MapAssertionKind,lifecycle: null == lifecycle ? _self.lifecycle : lifecycle // ignore: cast_nullable_to_non_nullable
as MapLifecycle,time: null == time ? _self.time : time // ignore: cast_nullable_to_non_nullable
as MapItemTime,sources: null == sources ? _self._sources : sources // ignore: cast_nullable_to_non_nullable
as List<MapSource>,details: null == details ? _self.details : details // ignore: cast_nullable_to_non_nullable
as AggregateDetails,geometryPresentation: freezed == geometryPresentation ? _self.geometryPresentation : geometryPresentation // ignore: cast_nullable_to_non_nullable
as GeometryPresentation?,
  ));
}

/// Create a copy of MapItem
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$GeoJsonGeometryCopyWith<$Res>? get geometry {
    if (_self.geometry == null) {
    return null;
  }

  return $GeoJsonGeometryCopyWith<$Res>(_self.geometry!, (value) {
    return _then(_self.copyWith(geometry: value));
  });
}
}

// dart format on
