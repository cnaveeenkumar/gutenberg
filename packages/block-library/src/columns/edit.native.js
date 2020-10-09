/**
 * External dependencies
 */
import { View, Dimensions } from 'react-native';
import { dropRight, times, map, compact, delay } from 'lodash';

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	PanelBody,
	RangeControl,
	FooterMessageControl,
	WIDE_ALIGNMENTS,
} from '@wordpress/components';
import {
	InspectorControls,
	InnerBlocks,
	BlockControls,
	BlockVerticalAlignmentToolbar,
	BlockVariationPicker,
} from '@wordpress/block-editor';
import { withDispatch, useSelect } from '@wordpress/data';
import { useEffect, useState, useMemo } from '@wordpress/element';
import { useResizeObserver } from '@wordpress/compose';
import { createBlock } from '@wordpress/blocks';
/**
 * Internal dependencies
 */
import variations from './variations';
import styles from './editor.scss';
import {
	hasExplicitColumnWidths,
	getMappedColumnWidths,
	getRedistributedColumnWidths,
	toWidthPrecision,
	getColumnWidths,
} from './utils';
import {
	getColumnsInRow,
	getContainerWidth,
	getContentWidths,
} from './columnCalculations.native';
import ColumnsPreview from '../column/column-preview';

/**
 * Allowed blocks constant is passed to InnerBlocks precisely as specified here.
 * The contents of the array should never change.
 * The array should contain the name of each block that is allowed.
 * In columns block, the only block we allow is 'core/column'.
 *
 * @constant
 * @type {string[]}
 */
const ALLOWED_BLOCKS = [ 'core/column' ];

/**
 * Number of columns to assume for template in case the user opts to skip
 * template option selection.
 *
 * @type {number}
 */
const DEFAULT_COLUMNS_NUM = 2;

/**
 * Minimum number of columns in a row
 *
 * @type {number}
 */
const MIN_COLUMNS_NUM = 1;

function ColumnsEditContainer( {
	attributes,
	updateAlignment,
	updateColumns,
	columnCount,
	isSelected,
	onDeleteBlock,
	innerColumns,
	updateInnerColumnWidth,
	parentBlockAlignment,
	editorSidebarOpened,
} ) {
	const [ resizeListener, sizes ] = useResizeObserver();
	const [ columnsInRow, setColumnsInRow ] = useState( MIN_COLUMNS_NUM );
	const [ tempWidth, setTempWidth ] = useState( 0 );
	const screenWidth = Math.floor( Dimensions.get( 'window' ).width );

	const { verticalAlignment, align } = attributes;
	const { width } = sizes || {};

	const newColumnCount = columnCount || DEFAULT_COLUMNS_NUM;

	useEffect( () => {
		if ( columnCount === 0 ) {
			updateColumns( columnCount, newColumnCount );
		}
	}, [] );

	useEffect( () => {
		if ( width ) {
			if ( getColumnsInRow( width, columnCount ) !== columnsInRow ) {
				setColumnsInRow( getColumnsInRow( width, columnCount ) );
			}
		}
	}, [ width, columnCount ] );

	// Array of column width attribute values
	const columnWidthsValues = Object.values(
		getColumnWidths( innerColumns, columnCount )
	);

	const renderAppender = () => {
		const isFullWidth = align === WIDE_ALIGNMENTS.alignments.full;
		const isParentFullWidth =
			parentBlockAlignment === WIDE_ALIGNMENTS.alignments.full;
		const isEqualWidth = width === screenWidth;

		if ( isSelected ) {
			return (
				<View
					style={ [
						( isFullWidth || isParentFullWidth || isEqualWidth ) &&
							styles.columnAppender,
					] }
				>
					<InnerBlocks.ButtonBlockAppender
						onAddBlock={ () =>
							updateColumns( columnCount, columnCount + 1 )
						}
					/>
				</View>
			);
		}
		return null;
	};

	const getColumnsSliders = useMemo( () => {
		if ( ! editorSidebarOpened || ! isSelected ) {
			return null;
		}

		return innerColumns.map( ( column, index ) => (
			<RangeControl
				min={ 1 }
				max={ 100 }
				step={ 0.1 }
				value={ columnWidthsValues[ index ] }
				onChange={ ( value ) => setTempWidth( value ) }
				onComplete={ () =>
					updateInnerColumnWidth( tempWidth, column.clientId )
				}
				cellContainerStyle={ styles.cellContainerStyle }
				toFixed={ 1 }
				rangePreview={
					<ColumnsPreview
						columnWidths={ columnWidthsValues }
						selectedColumnIndex={ index }
					/>
				}
				key={ `${ column.clientId }-${ columnWidthsValues.length }` }
				shouldDisplayTextInput={ false }
			/>
		) );
	}, [ innerColumns, columnWidthsValues, editorSidebarOpened ] );

	const contentWidths = getContentWidths(
		columnsInRow,
		width,
		columnCount,
		innerColumns
	);

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Columns Settings' ) }>
					<RangeControl
						label={ __( 'Number of columns' ) }
						icon="columns"
						value={ columnCount }
						onChange={ ( value ) =>
							updateColumns( columnCount, value )
						}
						min={ MIN_COLUMNS_NUM }
						max={ columnCount + 1 }
						type="stepper"
					/>
					{ getColumnsSliders }
				</PanelBody>
				<PanelBody>
					<FooterMessageControl
						label={ __(
							'Note: Column layout may vary between themes and screen sizes'
						) }
					/>
				</PanelBody>
			</InspectorControls>
			<BlockControls>
				<BlockVerticalAlignmentToolbar
					onChange={ updateAlignment }
					value={ verticalAlignment }
				/>
			</BlockControls>
			<View style={ isSelected && styles.innerBlocksSelected }>
				{ resizeListener }
				{ width && (
					<InnerBlocks
						renderAppender={ renderAppender }
						orientation={
							columnsInRow > 1 ? 'horizontal' : undefined
						}
						horizontal={ true }
						allowedBlocks={ ALLOWED_BLOCKS }
						contentResizeMode="stretch"
						onAddBlock={ () =>
							updateColumns( columnCount, columnCount + 1 )
						}
						onDeleteBlock={
							columnCount === 1 ? onDeleteBlock : undefined
						}
						blockWidth={ width }
						contentStyle={ contentWidths }
						parentWidth={
							align === WIDE_ALIGNMENTS.alignments.full &&
							columnCount === 0
								? screenWidth
								: getContainerWidth( width, columnsInRow )
						}
					/>
				) }
			</View>
		</>
	);
}

const ColumnsEditContainerWrapper = withDispatch(
	( dispatch, ownProps, registry ) => ( {
		/**
		 * Update all child Column blocks with a new vertical alignment setting
		 * based on whatever alignment is passed in. This allows change to parent
		 * to overide anything set on a individual column basis.
		 *
		 * @param {string} verticalAlignment the vertical alignment setting
		 */
		updateAlignment( verticalAlignment ) {
			const { clientId, setAttributes } = ownProps;
			const { updateBlockAttributes } = dispatch( 'core/block-editor' );
			const { getBlockOrder } = registry.select( 'core/block-editor' );

			// Update own alignment.
			setAttributes( { verticalAlignment } );

			// Update all child Column Blocks to match
			const innerBlockClientIds = getBlockOrder( clientId );
			innerBlockClientIds.forEach( ( innerBlockClientId ) => {
				updateBlockAttributes( innerBlockClientId, {
					verticalAlignment,
				} );
			} );
		},
		updateInnerColumnWidth( value, columnId ) {
			const { updateBlockAttributes } = dispatch( 'core/block-editor' );

			updateBlockAttributes( columnId, {
				width: value,
			} );
		},
		updateBlockSettings( settings ) {
			const { clientId } = ownProps;
			const { updateBlockListSettings } = dispatch( 'core/block-editor' );
			updateBlockListSettings( clientId, settings );
		},
		/**
		 * Updates the column columnCount, including necessary revisions to child Column
		 * blocks to grant required or redistribute available space.
		 *
		 * @param {number} previousColumns Previous column columnCount.
		 * @param {number} newColumns      New column columnCount.
		 */
		updateColumns( previousColumns, newColumns ) {
			const { clientId } = ownProps;
			const { replaceInnerBlocks } = dispatch( 'core/block-editor' );
			const { getBlocks, getBlockAttributes } = registry.select(
				'core/block-editor'
			);

			let innerBlocks = getBlocks( clientId );
			const hasExplicitWidths = hasExplicitColumnWidths( innerBlocks );

			// Redistribute available width for existing inner blocks.
			const isAddingColumn = newColumns > previousColumns;

			// Get verticalAlignment from Columns block to set the same to new Column
			const { verticalAlignment } = getBlockAttributes( clientId ) || {};

			if ( isAddingColumn && hasExplicitWidths ) {
				// If adding a new column, assign width to the new column equal to
				// as if it were `1 / columns` of the total available space.
				const newColumnWidth = toWidthPrecision( 100 / newColumns );

				// Redistribute in consideration of pending block insertion as
				// constraining the available working width.
				const widths = getRedistributedColumnWidths(
					innerBlocks,
					100 - newColumnWidth
				);

				innerBlocks = [
					...getMappedColumnWidths( innerBlocks, widths ),
					...times( newColumns - previousColumns, () => {
						return createBlock( 'core/column', {
							width: newColumnWidth,
							verticalAlignment,
						} );
					} ),
				];
			} else if ( isAddingColumn ) {
				innerBlocks = [
					...innerBlocks,
					...times( newColumns - previousColumns, () => {
						return createBlock( 'core/column', {
							verticalAlignment,
						} );
					} ),
				];
			} else {
				// The removed column will be the last of the inner blocks.
				innerBlocks = dropRight(
					innerBlocks,
					previousColumns - newColumns
				);

				if ( hasExplicitWidths ) {
					// Redistribute as if block is already removed.
					const widths = getRedistributedColumnWidths(
						innerBlocks,
						100
					);

					innerBlocks = getMappedColumnWidths( innerBlocks, widths );
				}
			}

			replaceInnerBlocks( clientId, innerBlocks, false );
		},
		onAddNextColumn: () => {
			const { clientId } = ownProps;
			const { replaceInnerBlocks, selectBlock } = dispatch(
				'core/block-editor'
			);
			const { getBlocks, getBlockAttributes } = registry.select(
				'core/block-editor'
			);

			// Get verticalAlignment from Columns block to set the same to new Column
			const { verticalAlignment } = getBlockAttributes( clientId );

			const innerBlocks = getBlocks( clientId );

			const insertedBlock = createBlock( 'core/column', {
				verticalAlignment,
			} );

			replaceInnerBlocks(
				clientId,
				[ ...innerBlocks, insertedBlock ],
				true
			);
			selectBlock( insertedBlock.clientId );
		},
		onDeleteBlock: () => {
			const { clientId } = ownProps;
			const { removeBlock } = dispatch( 'core/block-editor' );
			removeBlock( clientId );
		},
	} )
)( ColumnsEditContainer );

const ColumnsEdit = ( props ) => {
	const { clientId, isSelected } = props;
	const {
		columnCount,
		isDefaultColumns,
		innerColumns = [],
		hasParents,
		parentBlockAlignment,
		editorSidebarOpened,
	} = useSelect(
		( select ) => {
			const {
				getBlockCount,
				getBlock,
				getBlockParents,
				getBlockAttributes,
			} = select( 'core/block-editor' );
			const { isEditorSidebarOpened } = select( 'core/edit-post' );
			const block = getBlock( clientId );
			const innerBlocks = block?.innerBlocks;
			const isContentEmpty = map(
				innerBlocks,
				( innerBlock ) => innerBlock.innerBlocks.length
			);
			const parents = getBlockParents( clientId, true );

			return {
				columnCount: getBlockCount( clientId ),
				isDefaultColumns: ! compact( isContentEmpty ).length,
				innerColumns: innerBlocks,
				hasParents: !! parents.length,
				parentBlockAlignment: getBlockAttributes( parents[ 0 ] )?.align,
				editorSidebarOpened: isEditorSidebarOpened(),
			};
		},
		[ clientId ]
	);

	const [ isVisible, setIsVisible ] = useState( false );

	useEffect( () => {
		if ( isSelected && isDefaultColumns ) {
			delay( () => setIsVisible( true ), 100 );
		}
	}, [] );

	return (
		<>
			<ColumnsEditContainerWrapper
				columnCount={ columnCount }
				innerColumns={ innerColumns }
				hasParents={ hasParents }
				parentBlockAlignment={ parentBlockAlignment }
				editorSidebarOpened={ editorSidebarOpened }
				{ ...props }
			/>
			<BlockVariationPicker
				variations={ variations }
				onClose={ () => setIsVisible( false ) }
				clientId={ clientId }
				isVisible={ isVisible }
			/>
		</>
	);
};

export default ColumnsEdit;
